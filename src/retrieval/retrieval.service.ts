import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PostgresRagService } from "./postgres-rag.service";
import { VectorService } from "./vector.service";
import { OllamaService } from "../ollama/ollama.service";
import { RAG_CONFIDENCE_THRESHOLD } from "./rag-confidence";
import { RETRIEVAL_PROMPTS } from "./constants/retrieval-prompts";
import { Bm25Searcher } from "./bm25-searcher";
import { CrossEncoderReranker } from "./cross-encoder-reranker";
import {
  DomainDoc, RetrievalResult, HybridSearchMode, RetrievalHints,
} from "./retrieval.types";
import {
  normalizeForMatching, getAllowedDomains, getSourceKey, getCategoryKey,
  hasNearDuplicateTitle, isChunkDoc, getParentId, getChunkIndex, getChunkTotal,
  extractLink, excludeFoodDomainDocs, normalizeDocDomain,
} from "./retrieval.utils";

// RRF (Reciprocal Rank Fusion) Parameters
const RRF_K = 60;
const CROSS_ENCODER_LITE_TOPK = 10;
const CROSS_ENCODER_BLEND_WEIGHT = 0.4;

@Injectable()
export class RetrievalService implements OnModuleInit {
  private docs: DomainDoc[] = [];
  private isIndexReady = false;
  private isVectorReady = false;
  private hybridMode: HybridSearchMode = "hybrid";
  private bm25Searcher: Bm25Searcher;
  private crossEncoder: CrossEncoderReranker;
  /** Lowercase domain -> doc ids (rebuilt when docs load). */
  private domainToDocIds: Map<string, string[]> = new Map();
  /** Doc ID -> Lowercase domain cache (rebuilt when docs load). */
  private docIdToDomain: Map<string, string> = new Map();

  constructor(
    private readonly config: ConfigService,
    private readonly vectorService: VectorService,
    private readonly postgresRagService: PostgresRagService,
    private readonly ollamaService: OllamaService,
  ) {
    this.bm25Searcher = new Bm25Searcher(config);
    this.crossEncoder = new CrossEncoderReranker(ollamaService, config);
  }

  async onModuleInit() {
    const t0 = performance.now();

    try {
      const retrievalMode = String(
        this.config.get<string>("RETRIEVAL_MODE") || this.config.get<string>("HYBRID_MODE") || "hybrid"
      ).toLowerCase().trim().replace(/_/g, "-");
      if (retrievalMode === "bm25-only") this.hybridMode = "bm25-only";
      else if (retrievalMode === "vector-only") this.hybridMode = "vector-only";
      else this.hybridMode = "hybrid";

      await this.loadDomainData();
      this.buildDomainDocIdMap();
      console.log(`[RETRIEVAL] 📂 Indexed domains: ${this.getIndexedDomains().join(", ") || "(none)"}`);
      this.buildIndices();
      this.isIndexReady = true;

      const syncEmbeddingsOnBoot = String(
        this.config.get<string>("POSTGRES_SYNC_EMBEDDINGS_ON_BOOT") || "true"
      ).toLowerCase() === "true";

      if (syncEmbeddingsOnBoot) {
        const docsForEmbedding = this.docs.map((doc) => ({
          id: doc.id,
          text: `${doc.title} ${doc.content}`.substring(0, 2000),
        }));
        const syncStats = await this.vectorService.ensureEmbeddingsForDocuments(docsForEmbedding);
        this.isVectorReady = this.vectorService.isServiceReady();
        console.log(
          `[RETRIEVAL]  Vector sync: +${syncStats.added}, ~${syncStats.updated}, -${syncStats.removed}, unchanged ${syncStats.skipped}, failed ${syncStats.failed}`
        );
      } else {
        this.isVectorReady = this.vectorService.isServiceReady();
        console.log("[RETRIEVAL]  Skip vector sync on boot (POSTGRES_SYNC_EMBEDDINGS_ON_BOOT=false)");
      }

      if (!this.isVectorReady && this.hybridMode !== "bm25-only") {
        console.warn("[RETRIEVAL]  Vector not ready; using BM25-only for retrieval until embeddings are available.");
        this.hybridMode = "bm25-only";
      }

      const t1 = performance.now();
      console.log(`[RETRIEVAL]  Initialized in ${(t1 - t0).toFixed(0)}ms`);
      console.log(`[RETRIEVAL]  Stats: ${this.docs.length} docs`);
      console.log(`[RETRIEVAL]  Hybrid Mode: ${this.hybridMode.toUpperCase()}`);
    } catch (error) {
      console.error("[RETRIEVAL]  Initialization failed:", error);
      this.isIndexReady = false;
      this.isVectorReady = false;
      this.hybridMode = "bm25-only";
    }
  }

  private buildIndices() {
    this.docs = excludeFoodDomainDocs(this.docs);
    this.buildDomainDocIdMap();
    if (this.docs.length === 0) {
      console.warn("[RETRIEVAL]  No documents to index");
      return;
    }
    this.bm25Searcher.build(this.docs);
  }

  private buildDomainDocIdMap() {
    this.domainToDocIds = new Map();
    this.docIdToDomain = new Map();
    for (const doc of this.docs) {
      const dom = String(doc.metadata?.domain || "unknown").toLowerCase().trim() || "unknown";
      if (!this.domainToDocIds.has(dom)) this.domainToDocIds.set(dom, []);
      this.domainToDocIds.get(dom)!.push(doc.id);
      this.docIdToDomain.set(doc.id, dom);
    }
  }

  getIndexedDomains(): string[] {
    return Array.from(this.domainToDocIds.keys()).sort();
  }

  async retrieve(
    question: string,
    topK: number = 5,
    hints: RetrievalHints = {},
    forceMode?: HybridSearchMode
  ): Promise<RetrievalResult[]> {
    const t0 = performance.now();

    try {
      if (!this.isIndexReady || this.docs.length === 0) return [];

      const subQueries = await this.expandQuery(question, hints);
      console.log(`[RETRIEVAL]  Expanded query into ${subQueries.length} terms: ${subQueries.join(", ")}`);

      const allResults = new Map<string, number>();

      for (const query of subQueries) {
        const results = await this.performSearch(query, Math.max(topK * 2, 20), hints, forceMode);
        for (let i = 0; i < results.length; i++) {
          const rank = i + 1;
          const score = 1 / (RRF_K + rank);
          allResults.set(results[i].id, (allResults.get(results[i].id) || 0) + score);
        }
      }

      if (forceMode && forceMode !== "hybrid") {
        return Array.from(allResults.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, topK)
          .map(([id, score]) => {
            const doc = this.docs.find((d) => d.id === id);
            return doc ? this.formatRetrievalResult(doc, score) : null;
          })
          .filter((r): r is RetrievalResult => r !== null);
      }

      // Semantic re-ranking
      const finalDocIds = Array.from(allResults.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topK * 3)
        .map(([id]) => id);

      const candidateDocs = this.docs.filter((d) => finalDocIds.includes(d.id));
      const candidateDocIds = candidateDocs.map((doc) => doc.id);

      const queryEmbedding = await this.vectorService.getQueryEmbedding(question);
      const pgSemantic = new Map<string, number>();
      if (this.vectorService.docEmbeddingsInPostgres() && candidateDocIds.length > 0) {
        const ranked = await this.vectorService.vectorSearch(queryEmbedding, candidateDocIds, candidateDocIds.length);
        for (const r of ranked) pgSemantic.set(r.docId, r.score);
      }

      const scoredDocs = candidateDocs.map((doc) => {
        if (pgSemantic.size > 0) {
          const s = pgSemantic.get(doc.id);
          if (typeof s === "number") return { doc, semanticScore: s };
        }
        const docEmbedding = this.vectorService.getCachedEmbedding(doc.id);
        if (!docEmbedding) return { doc, semanticScore: 0.1 };
        return { doc, semanticScore: this.vectorService.cosineSimilarity(queryEmbedding, docEmbedding) };
      });

      const crossEncoderScores = !hints.skipCrossEncoder && this.crossEncoder.isEnabled()
        ? await this.crossEncoder.rerank(
            question,
            candidateDocs.filter((doc) => candidateDocIds.slice(0, CROSS_ENCODER_LITE_TOPK).includes(doc.id))
          )
        : new Map<string, number>();

      const maxRrf = finalDocIds.length > 0
        ? Math.max(...finalDocIds.map((id) => allResults.get(id) || 0.0001))
        : 1.0;

      const rankedDocs = scoredDocs.map(({ doc, semanticScore }) => {
        const crossScore = crossEncoderScores.get(doc.id);
        if (typeof crossScore === "number") {
          const score = (1 - CROSS_ENCODER_BLEND_WEIGHT) * semanticScore + CROSS_ENCODER_BLEND_WEIGHT * crossScore;
          return { doc, score, semanticScore, crossScore };
        }
        const normRrf = (allResults.get(doc.id) || 0) / maxRrf;
        return { doc, score: 0.4 * semanticScore + 0.6 * normRrf, semanticScore };
      });

      const diversifiedDocs = this.applyDiversityRerank(
        rankedDocs
          .filter(({ score }) => score >= RAG_CONFIDENCE_THRESHOLD)
          .map(({ doc, score }) => ({ doc, score })),
        topK,
        hints
      );

      const results = diversifiedDocs.map(({ doc, score }) => this.formatRetrievalResult(doc, score));

      const t1 = performance.now();
      console.log(`[RETRIEVAL]  Smart Search done in ${(t1 - t0).toFixed(1)}ms`);
      return results;

    } catch (error) {
      console.error("[RETRIEVAL]  Smart Retrieve error:", error);
      return [];
    }
  }

  private formatRetrievalResult(doc: DomainDoc, score: number): RetrievalResult {
    return {
      id: doc.id,
      source: doc.source,
      title: doc.title,
      content: doc.content.substring(0, 500) + (doc.content.length > 500 ? "..." : ""),
      domain: String(doc.metadata?.domain || "unknown"),
      score: parseFloat(Number(score || 0).toFixed(4)),
      link: extractLink(doc),
      isChunk: isChunkDoc(doc),
      parentId: getParentId(doc),
      chunkIndex: getChunkIndex(doc),
      chunkTotal: getChunkTotal(doc),
    };
  }

  // Query expansion cache: question -> [subQueries]
  private expansionCache = new Map<string, { result: string[]; cachedAt: number }>();
  private readonly expansionCacheTTL = 5 * 60 * 1000; // 5 minutes

  private async expandQuery(question: string, hints: RetrievalHints): Promise<string[]> {
    const enabled = !hints.skipExpansion
      && String(this.config.get<string>("RETRIEVAL_QUERY_EXPANSION_ENABLED") || "true").toLowerCase() === "true";
    if (!enabled) return [question];

    // Skip expansion for short queries — LLM rewrite not worth latency
    const WORD_THRESHOLD = 3;
    if (question.split(/\s+/).length <= WORD_THRESHOLD) {
      return [question];
    }

    // Check cache
    const cached = this.expansionCache.get(question);
    if (cached && Date.now() - cached.cachedAt < this.expansionCacheTTL) {
      return cached.result;
    }

    try {
      const intent = hints.intent || "general";
      const prompt = RETRIEVAL_PROMPTS.QUERY_REWRITE(intent, question);

      const response = await this.ollamaService.chat([
        {
          role: "system",
          content: "You are a search-query paraphraser. Return ONLY a JSON array of strings. No extra text. No generic meal-plan drift.",
        },
        { role: "user", content: prompt },
      ]);

      const match = response.match(/\[.*\]/s);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          const validTerms = parsed
            .map((term: unknown) => {
              if (typeof term === "string") return term.trim();
              if (term && typeof term === "object") return Object.values(term as object).join(" ").trim();
              return String(term ?? "").trim();
            })
            .filter((term: string) => term.length > 0);
          const result = [question, ...validTerms];
          this.expansionCache.set(question, { result, cachedAt: Date.now() });
          return result;
        }
      }
    } catch (e) {
      console.warn("[RETRIEVAL]  Query expansion failed, using original query:", (e as Error).message);
    }
    return [question];
  }

  private getEffectiveHybridMode(): HybridSearchMode {
    if (!this.isVectorReady) return "bm25-only";
    return this.hybridMode;
  }

  private async performSearch(
    query: string,
    topK: number,
    hints: RetrievalHints,
    forceMode?: HybridSearchMode
  ): Promise<RetrievalResult[]> {
    const mode = forceMode ?? this.getEffectiveHybridMode();

    if (mode === "vector-only") {
      return this.performVectorOnlySearch(query, topK, hints);
    }

    const bm25Results = this.bm25Searcher.search(query, hints);

    if (mode === "bm25-only") {
      return this.bm25RankedToResults(bm25Results, topK);
    }

    try {
      const queryEmbedding = await this.vectorService.getQueryEmbedding(query);
      const vectorSearchResults = await this.vectorService.vectorSearchAll(queryEmbedding, topK * 2);

      let filteredVectorResults = vectorSearchResults;
      const allowed = getAllowedDomains(hints);
      if (allowed) {
        filteredVectorResults = vectorSearchResults.filter((r) => {
          const dom = this.docIdToDomain.get(r.docId);
          return dom && allowed.has(dom);
        });
      }

      const vectorRanked = filteredVectorResults.map((r, idx) => ({ ...r, rank: idx + 1 }));
      const fusion = this.rrfFusion(bm25Results, vectorRanked);

      return Array.from(fusion.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id, score]) => {
          const doc = this.docs.find((d) => d.id === id);
          return doc
            ? { id: doc.id, source: doc.source, title: doc.title, content: doc.content, domain: String(doc.metadata?.domain || ""), score }
            : null;
        })
        .filter((r) => r !== null) as RetrievalResult[];
    } catch (error) {
      console.warn("[RETRIEVAL] Hybrid vector stage failed; BM25-only fallback:", error);
      return this.bm25RankedToResults(bm25Results, topK);
    }
  }

  private bm25RankedToResults(
    results: Array<{ docId: string; score: number; rank: number }>,
    topK: number
  ): RetrievalResult[] {
    return results.slice(0, topK).map((r) => {
      const doc = this.docs.find((d) => d.id === r.docId);
      return doc
        ? { id: doc.id, source: doc.source, title: doc.title, content: doc.content, domain: String(doc.metadata?.domain || ""), score: r.score }
        : null;
    }).filter((r) => r !== null) as RetrievalResult[];
  }

  private async performVectorOnlySearch(
    query: string,
    topK: number,
    hints: RetrievalHints
  ): Promise<RetrievalResult[]> {
    if (!this.isVectorReady) {
      return this.bm25RankedToResults(this.bm25Searcher.search(query, hints), topK);
    }
    try {
      const queryEmbedding = await this.vectorService.getQueryEmbedding(query);
      const vectorSearchResults = await this.vectorService.vectorSearchAll(queryEmbedding, topK * 2);

      let filtered = vectorSearchResults;
      const allowed = getAllowedDomains(hints);
      if (allowed) {
        filtered = vectorSearchResults.filter((r) => {
          const dom = this.docIdToDomain.get(r.docId);
          return dom && allowed.has(dom);
        });
      }

      return filtered.slice(0, topK).map((r) => {
        const doc = this.docs.find((d) => d.id === r.docId);
        return doc
          ? { id: doc.id, source: doc.source, title: doc.title, content: doc.content, domain: String(doc.metadata?.domain || ""), score: r.score }
          : null;
      }).filter((r) => r !== null) as RetrievalResult[];
    } catch (error) {
      console.warn("[RETRIEVAL]  vector-only search failed; BM25 fallback:", error);
      return this.bm25RankedToResults(this.bm25Searcher.search(query, hints), topK);
    }
  }

  private rrfFusion(
    bm25Results: Array<{ docId: string; score: number; rank: number }>,
    vectorResults: Array<{ docId: string; score: number; rank: number }>
  ): Map<string, number> {
    const rrfScores = new Map<string, number>();
    for (const r of bm25Results) rrfScores.set(r.docId, (rrfScores.get(r.docId) || 0) + 1 / (RRF_K + r.rank));
    for (const r of vectorResults) rrfScores.set(r.docId, (rrfScores.get(r.docId) || 0) + 1 / (RRF_K + r.rank));
    return rrfScores;
  }

  private applyDiversityRerank(
    scored: Array<{ doc: DomainDoc; score: number }>,
    topK: number,
    hints: RetrievalHints
  ): Array<{ doc: DomainDoc; score: number }> {
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    if (sorted.length <= topK) return sorted;

    const windowSize = Math.min(sorted.length, Math.max(topK * 6, 24));
    const pool = sorted.slice(0, windowSize);
    const selected: Array<{ doc: DomainDoc; score: number }> = [];
    const sourceCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    const maxPerSource = topK >= 5 ? 2 : 1;
    const maxPerCategory = topK >= 5 ? 2 : 1;

    for (const candidate of pool) {
      if (selected.length >= topK) break;
      const sourceKey = getSourceKey(candidate.doc);
      const categoryKey = getCategoryKey(candidate.doc);
      if ((sourceCounts.get(sourceKey) || 0) >= maxPerSource) continue;
      if ((categoryCounts.get(categoryKey) || 0) >= maxPerCategory) continue;
      if (hasNearDuplicateTitle(selected, candidate)) continue;

      const adjustedScore = this.adjustedDiversityScore(candidate, sourceCounts, categoryCounts, hints);
      selected.push({ ...candidate, score: adjustedScore });
      sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) || 0) + 1);
      categoryCounts.set(categoryKey, (categoryCounts.get(categoryKey) || 0) + 1);
    }

    if (selected.length < topK) {
      for (const candidate of pool) {
        if (selected.length >= topK) break;
        if (selected.some((s) => s.doc.id === candidate.doc.id)) continue;
        if (hasNearDuplicateTitle(selected, candidate)) continue;
        selected.push(candidate);
      }
    }

    return selected.sort((a, b) => b.score - a.score);
  }

  private adjustedDiversityScore(
    candidate: { doc: DomainDoc; score: number },
    sourceCounts: Map<string, number>,
    categoryCounts: Map<string, number>,
    hints: RetrievalHints
  ): number {
    const sourceKey = getSourceKey(candidate.doc);
    const domain = String(candidate.doc.metadata?.domain || "unknown").toLowerCase();
    const categoryKey = getCategoryKey(candidate.doc);
    const sourcePenalty = 1 / (1 + 0.3 * (sourceCounts.get(sourceKey) || 0));
    const categoryPenalty = 1 / (1 + 0.3 * (categoryCounts.get(categoryKey) || 0));
    const intent = hints.intent || "general";
    const hasConditionContext = Boolean(hints.hasConditionContext);
    const foodGuardPenalty = intent === "food_specific" && !hasConditionContext && ["conditions"].includes(domain) ? 0.72 : 1;
    return candidate.score * sourcePenalty * categoryPenalty * foodGuardPenalty;
  }

  setHybridMode(mode: HybridSearchMode): void {
    if (["bm25-only", "vector-only", "hybrid"].includes(mode)) {
      this.hybridMode = mode;
      console.log(`[RETRIEVAL]  Hybrid mode set to: ${mode}`);
    } else {
      console.warn(`[RETRIEVAL]  Invalid hybrid mode: ${mode}`);
    }
  }

  getRetrievalStats() {
    return {
      bm25Ready: this.isIndexReady,
      vectorReady: this.isVectorReady,
      hybridMode: this.hybridMode,
      effectiveHybridMode: this.getEffectiveHybridMode(),
      totalDocs: this.docs.length,
      vectorStats: this.vectorService.getStats(),
    };
  }

  getIndexStats() {
    return {
      totalDocs: this.docs.length,
      isReady: this.isIndexReady,
      bm25Params: this.bm25Searcher.getBm25Params(),
    };
  }

  async rebuildIndex() {
    console.log("[RETRIEVAL]  Rebuilding index...");
    this.isIndexReady = false;
    await this.loadDomainData();
    this.buildIndices();
    this.isIndexReady = true;
    console.log("[RETRIEVAL]  Index rebuilt");
  }

  private async loadDomainData() {
    const usePostgresStorage = String(
      this.config.get<string>("USE_POSTGRES_STORAGE") || "false"
    ).toLowerCase() === "true";
    if (!usePostgresStorage) throw new Error("DB-only mode requires USE_POSTGRES_STORAGE=true.");

    if (!this.postgresRagService.isEnabled()) {
      throw new Error("DB-only mode requires PostgreSQL RAG storage to be enabled and reachable.");
    }

    await this.postgresRagService.ensureSchema();
    const corpus = await this.postgresRagService.loadCorpus();
    if (corpus.docs.length === 0) {
      throw new Error("DB-only mode found no RAG docs in PostgreSQL. Run the sync/import pipeline first.");
    }

    this.docs = excludeFoodDomainDocs(corpus.docs).filter((doc) => doc?.id && doc?.content);
    this.docs = this.docs.map(normalizeDocDomain);
    console.log("[DATA]  Loaded corpus from PostgreSQL (DB-only)");
    console.log(`[DATA]  Loaded: ${this.docs.length} docs`);
  }
}
