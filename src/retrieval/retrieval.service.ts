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

const REBUILD_DEBOUNCE_MS = 2000;
/** RAG_QUERY_EMBED_TIMEOUT_MS default: past this, the request goes on without vector scores (BM25 only). */
const DEFAULT_QUERY_EMBED_TIMEOUT_MS = 3000;

type QueryEmbedder = (text: string) => Promise<number[]>;

/** Everything derived from one corpus load; swapped in as a single unit. */
type RagIndex = {
  docs: DomainDoc[];
  bm25Searcher: Bm25Searcher;
  /** Lowercase domain -> doc ids. */
  domainToDocIds: Map<string, string[]>;
  /** Doc ID -> lowercase domain. */
  docIdToDomain: Map<string, string>;
};

@Injectable()
export class RetrievalService implements OnModuleInit {
  private isIndexReady = false;
  private isVectorReady = false;
  private hybridMode: HybridSearchMode = "hybrid";
  private crossEncoder: CrossEncoderReranker;
  private index: RagIndex;
  private rebuildRunning: Promise<void> | null = null;
  private rebuildAgain = false;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly vectorService: VectorService,
    private readonly postgresRagService: PostgresRagService,
    private readonly ollamaService: OllamaService,
  ) {
    this.index = this.buildIndex([]);
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

      this.index = this.buildIndex(await this.loadDomainData());
      console.log(`[RETRIEVAL] 📂 Indexed domains: ${this.getIndexedDomains().join(", ") || "(none)"}`);
      this.isIndexReady = true;

      // No boot embedding sync for RAG: it re-embedded chunks with a different text and deleted
      // the embeddings of inactive chunks. The ingest pipeline (and admin edits) own rag_embeddings.
      const syncEmbeddingsOnBoot = String(
        this.config.get<string>("POSTGRES_SYNC_EMBEDDINGS_ON_BOOT") || "false"
      ).toLowerCase() === "true";
      if (syncEmbeddingsOnBoot) {
        console.warn(
          "[RETRIEVAL]  POSTGRES_SYNC_EMBEDDINGS_ON_BOOT=true is ignored: the ingest pipeline owns RAG embeddings"
        );
      }
      this.isVectorReady = this.vectorService.isServiceReady();

      if (!this.isVectorReady && this.hybridMode !== "bm25-only") {
        console.warn("[RETRIEVAL]  Vector not ready; using BM25-only for retrieval until embeddings are available.");
        this.hybridMode = "bm25-only";
      }

      const t1 = performance.now();
      console.log(`[RETRIEVAL]  Initialized in ${(t1 - t0).toFixed(0)}ms`);
      console.log(`[RETRIEVAL]  Stats: ${this.index.docs.length} docs`);
      console.log(`[RETRIEVAL]  Hybrid Mode: ${this.hybridMode.toUpperCase()}`);
    } catch (error) {
      console.error("[RETRIEVAL]  Initialization failed:", error);
      this.isIndexReady = false;
      this.isVectorReady = false;
      this.hybridMode = "bm25-only";
    }
  }

  /** Builds a complete, independent index; touches no instance state. */
  private buildIndex(rawDocs: DomainDoc[]): RagIndex {
    const docs = excludeFoodDomainDocs(rawDocs);
    const bm25Searcher = new Bm25Searcher(this.config);
    const domainToDocIds = new Map<string, string[]>();
    const docIdToDomain = new Map<string, string>();
    for (const doc of docs) {
      const dom = String(doc.metadata?.domain || "unknown").toLowerCase().trim() || "unknown";
      if (!domainToDocIds.has(dom)) domainToDocIds.set(dom, []);
      domainToDocIds.get(dom)!.push(doc.id);
      docIdToDomain.set(doc.id, dom);
    }
    if (docs.length === 0) {
      console.warn("[RETRIEVAL]  No documents to index");
    } else {
      bm25Searcher.build(docs);
    }
    return { docs, bm25Searcher, domainToDocIds, docIdToDomain };
  }

  getIndexedDomains(): string[] {
    return Array.from(this.index.domainToDocIds.keys()).sort();
  }

  /** Coalesce rebuild requests made within the debounce window into one rebuild. */
  scheduleRebuild(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      void this.rebuildIndex();
    }, REBUILD_DEBOUNCE_MS);
    this.rebuildTimer.unref?.();
  }

  async retrieve(
    question: string,
    topK: number = 5,
    hints: RetrievalHints = {},
    forceMode?: HybridSearchMode
  ): Promise<RetrievalResult[]> {
    const t0 = performance.now();

    // Snapshot: a rebuild swapping this.index mid-call must not mix old and new structures.
    const index = this.index;

    try {
      if (!this.isIndexReady || index.docs.length === 0) return [];

      const subQueries = await this.expandQuery(question, hints);
      console.log(`[RETRIEVAL]  Expanded query into ${subQueries.length} terms: ${subQueries.join(", ")}`);

      const embedQuery = this.createQueryEmbedder();
      const allResults = new Map<string, number>();

      for (const query of subQueries) {
        const results = await this.performSearch(index, query, Math.max(topK * 2, 20), hints, embedQuery, forceMode);
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
            const doc = index.docs.find((d) => d.id === id);
            return doc ? this.formatRetrievalResult(doc, score) : null;
          })
          .filter((r): r is RetrievalResult => r !== null);
      }

      // Semantic re-ranking
      const finalDocIds = Array.from(allResults.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topK * 3)
        .map(([id]) => id);

      const candidateDocs = index.docs.filter((d) => finalDocIds.includes(d.id));
      const candidateDocIds = candidateDocs.map((doc) => doc.id);

      // A slow or failed query embedding degrades the re-rank to RRF only instead of failing the request.
      let queryEmbedding: number[] | null = null;
      try {
        queryEmbedding = await embedQuery(question);
      } catch (error) {
        console.warn(`[RETRIEVAL]  Query embedding unavailable; re-ranking without semantic scores: ${(error as Error)?.message ?? error}`);
      }
      const pgSemantic = new Map<string, number>();
      if (queryEmbedding && this.vectorService.docEmbeddingsInPostgres() && candidateDocIds.length > 0) {
        const ranked = await this.vectorService.vectorSearch(queryEmbedding, candidateDocIds, candidateDocIds.length);
        for (const r of ranked) pgSemantic.set(r.docId, r.score);
      }

      const scoredDocs = candidateDocs.map((doc): { doc: DomainDoc; semanticScore: number | null } => {
        if (!queryEmbedding) return { doc, semanticScore: null };
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
        const normRrf = (allResults.get(doc.id) || 0) / maxRrf;
        // Without a query embedding the RRF score stands in for the semantic score.
        const baseScore = semanticScore ?? normRrf;
        const crossScore = crossEncoderScores.get(doc.id);
        if (typeof crossScore === "number") {
          const score = (1 - CROSS_ENCODER_BLEND_WEIGHT) * baseScore + CROSS_ENCODER_BLEND_WEIGHT * crossScore;
          return { doc, score, semanticScore, crossScore };
        }
        const score = semanticScore === null ? normRrf : 0.4 * semanticScore + 0.6 * normRrf;
        return { doc, score, semanticScore };
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
    const page = Number(doc.metadata?.page_from);
    const blockKind = doc.metadata?.block_kind;
    return {
      id: doc.id,
      source: doc.source,
      title: doc.title,
      // Whole chunk: callers size the prompt (buildRagReferenceBlock); a prefix
      // can end mid-number.
      content: doc.content,
      domain: String(doc.metadata?.domain || "unknown"),
      score: parseFloat(Number(score || 0).toFixed(4)),
      link: extractLink(doc),
      page: Number.isFinite(page) && page > 0 ? page : undefined,
      blockKind: typeof blockKind === "string" ? blockKind : undefined,
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

  /**
   * Query embedding for one retrieve() call, capped at RAG_QUERY_EMBED_TIMEOUT_MS (default 3000).
   * On timeout the Ollama request is aborted; after the first failure the rest of the request
   * skips the vector stage, so one request waits for the timeout at most once.
   * (AbortController + setTimeout rather than AbortSignal.timeout: same behaviour, and it runs
   * under Jest fake timers.)
   */
  private createQueryEmbedder(): QueryEmbedder {
    const configured = Number(this.config.get<string>("RAG_QUERY_EMBED_TIMEOUT_MS"));
    const timeoutMs = configured > 0 ? configured : DEFAULT_QUERY_EMBED_TIMEOUT_MS;
    let failure: Error | null = null;
    return async (text: string) => {
      if (failure) throw failure;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Query embedding timed out after ${timeoutMs} ms`));
        }, timeoutMs);
      });
      try {
        return await Promise.race([this.vectorService.getQueryEmbedding(text, controller.signal), timeout]);
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        throw failure;
      } finally {
        clearTimeout(timer);
      }
    };
  }

  private async performSearch(
    index: RagIndex,
    query: string,
    topK: number,
    hints: RetrievalHints,
    embedQuery: QueryEmbedder,
    forceMode?: HybridSearchMode
  ): Promise<RetrievalResult[]> {
    const mode = forceMode ?? this.getEffectiveHybridMode();

    if (mode === "vector-only") {
      return this.performVectorOnlySearch(index, query, topK, hints, embedQuery);
    }

    const bm25Results = index.bm25Searcher.search(query, hints);

    if (mode === "bm25-only") {
      return this.bm25RankedToResults(index, bm25Results, topK);
    }

    try {
      const queryEmbedding = await embedQuery(query);
      const vectorSearchResults = await this.vectorService.vectorSearchAll(queryEmbedding, topK * 2);

      let filteredVectorResults = vectorSearchResults;
      const allowed = getAllowedDomains(hints);
      if (allowed) {
        filteredVectorResults = vectorSearchResults.filter((r) => {
          const dom = index.docIdToDomain.get(r.docId);
          return dom && allowed.has(dom);
        });
      }

      const vectorRanked = filteredVectorResults.map((r, idx) => ({ ...r, rank: idx + 1 }));
      const fusion = this.rrfFusion(bm25Results, vectorRanked);

      return Array.from(fusion.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id, score]) => {
          const doc = index.docs.find((d) => d.id === id);
          return doc
            ? { id: doc.id, source: doc.source, title: doc.title, content: doc.content, domain: String(doc.metadata?.domain || ""), score }
            : null;
        })
        .filter((r) => r !== null) as RetrievalResult[];
    } catch (error) {
      console.warn("[RETRIEVAL] Hybrid vector stage failed; BM25-only fallback:", error);
      return this.bm25RankedToResults(index, bm25Results, topK);
    }
  }

  private bm25RankedToResults(
    index: RagIndex,
    results: Array<{ docId: string; score: number; rank: number }>,
    topK: number
  ): RetrievalResult[] {
    return results.slice(0, topK).map((r) => {
      const doc = index.docs.find((d) => d.id === r.docId);
      return doc
        ? { id: doc.id, source: doc.source, title: doc.title, content: doc.content, domain: String(doc.metadata?.domain || ""), score: r.score }
        : null;
    }).filter((r) => r !== null) as RetrievalResult[];
  }

  private async performVectorOnlySearch(
    index: RagIndex,
    query: string,
    topK: number,
    hints: RetrievalHints,
    embedQuery: QueryEmbedder
  ): Promise<RetrievalResult[]> {
    if (!this.isVectorReady) {
      return this.bm25RankedToResults(index, index.bm25Searcher.search(query, hints), topK);
    }
    try {
      const queryEmbedding = await embedQuery(query);
      const vectorSearchResults = await this.vectorService.vectorSearchAll(queryEmbedding, topK * 2);

      let filtered = vectorSearchResults;
      const allowed = getAllowedDomains(hints);
      if (allowed) {
        filtered = vectorSearchResults.filter((r) => {
          const dom = index.docIdToDomain.get(r.docId);
          return dom && allowed.has(dom);
        });
      }

      return filtered.slice(0, topK).map((r) => {
        const doc = index.docs.find((d) => d.id === r.docId);
        return doc
          ? { id: doc.id, source: doc.source, title: doc.title, content: doc.content, domain: String(doc.metadata?.domain || ""), score: r.score }
          : null;
      }).filter((r) => r !== null) as RetrievalResult[];
    } catch (error) {
      console.warn("[RETRIEVAL]  vector-only search failed; BM25 fallback:", error);
      return this.bm25RankedToResults(index, index.bm25Searcher.search(query, hints), topK);
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
      totalDocs: this.index.docs.length,
      vectorStats: this.vectorService.getStats(),
    };
  }

  getIndexStats() {
    return {
      totalDocs: this.index.docs.length,
      isReady: this.isIndexReady,
      bm25Params: this.index.bm25Searcher.getBm25Params(),
    };
  }

  /**
   * Hot rebuild: the new index is built off to the side and swapped in as one unit,
   * so retrieve() keeps using the old index meanwhile. Concurrent calls collapse into
   * "run once more when the current rebuild finishes". Failures keep the old index.
   */
  rebuildIndex(): Promise<void> {
    if (this.rebuildRunning) {
      this.rebuildAgain = true;
      return this.rebuildRunning;
    }
    this.rebuildRunning = (async () => {
      try {
        do {
          this.rebuildAgain = false;
          await this.rebuildOnce();
        } while (this.rebuildAgain);
      } finally {
        this.rebuildRunning = null;
      }
    })();
    return this.rebuildRunning;
  }

  private async rebuildOnce(): Promise<void> {
    console.log("[RETRIEVAL]  Rebuilding index...");
    try {
      const next = this.buildIndex(await this.loadDomainData());
      this.index = next;
      this.isIndexReady = true;
      console.log(`[RETRIEVAL]  Index rebuilt (${next.docs.length} docs)`);
    } catch (error) {
      console.error("[RETRIEVAL]  Index rebuild failed; keeping previous index:", error);
    }
  }

  private async loadDomainData(): Promise<DomainDoc[]> {
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
      console.warn("[DATA]  RAG store is empty; retrieval returns nothing until knowledge is ingested.");
    }

    const docs = excludeFoodDomainDocs(corpus.docs)
      .filter((doc) => doc?.id && doc?.content)
      .map(normalizeDocDomain);
    console.log("[DATA]  Loaded corpus from PostgreSQL (DB-only)");
    console.log(`[DATA]  Loaded: ${docs.length} docs`);
    return docs;
  }
}
