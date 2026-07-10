import { DomainDoc, RetrievalHints, RankedResult } from "./retrieval.types";
import { tokenize, normalizeForMatching, getDomainBoost, getAllowedDomains, excludeFoodDomainDocs } from "./retrieval.utils";
import { ConfigService } from "@nestjs/config";

const lunr = require("lunr");

// BM25 Hyperparameters
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const LUNR_CANDIDATE_LIMIT = 100;
const MIN_CANDIDATES_BEFORE_FALLBACK = 30;
const FALLBACK_BM25_LIMIT = 300;
const DOMAIN_FILTER_MIN_CANDIDATES = 5;

export class Bm25Searcher {
  private readonly invertedIndex = new Map<string, Set<string>>();
  private readonly idfCache = new Map<string, number>();
  private readonly docTokensCache = new Map<string, string[]>();
  private readonly docLengthCache = new Map<string, number>();
  private avgDocLength = 0;
  private lunrIndex: any = null;
  private docs: DomainDoc[] = [];

  constructor(private readonly config: ConfigService) {}

  build(docs: DomainDoc[]) {
    this.docs = excludeFoodDomainDocs(docs);
    if (this.docs.length === 0) return;

    this.buildLunrIndex();
    this.buildBM25Structures();
  }

  private buildLunrIndex() {
    this.lunrIndex = lunr((idx: any) => {
      idx.ref("id");
      idx.field("title", { boost: 10 });
      idx.field("content", { boost: 1 });
      idx.field("domain", { boost: 5 });
      idx.field("metadata", { boost: 2 });

      for (const doc of this.docs) {
        idx.add({
          id: doc.id,
          title: normalizeForMatching(doc.title),
          content: normalizeForMatching(doc.content),
          domain: normalizeForMatching(String(doc.metadata?.domain || "")),
          metadata: normalizeForMatching(JSON.stringify(doc.metadata || {})),
        });
      }
    });
    console.log(`[LUNR]  Built index with ${this.docs.length} documents`);
  }

  private buildBM25Structures() {
    this.invertedIndex.clear();
    this.idfCache.clear();
    this.docTokensCache.clear();
    this.docLengthCache.clear();

    const N = this.docs.length;
    let totalTokens = 0;

    for (const doc of this.docs) {
      const text = `${doc.title} ${doc.content} ${JSON.stringify(doc.metadata || {})}`.toLowerCase();
      const tokens = tokenize(text);
      this.docTokensCache.set(doc.id, tokens);
      this.docLengthCache.set(doc.id, tokens.length);
      totalTokens += tokens.length;

      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        if (!this.invertedIndex.has(token)) this.invertedIndex.set(token, new Set());
        this.invertedIndex.get(token)!.add(doc.id);
      }
    }

    this.avgDocLength = totalTokens / N;

    for (const [token, docIds] of this.invertedIndex) {
      const df = docIds.size;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      this.idfCache.set(token, idf);
    }

    console.log(`[BM25]  Built structures: ${this.invertedIndex.size} tokens, avg length: ${this.avgDocLength.toFixed(1)}`);
  }

  search(query: string, hints: RetrievalHints): RankedResult[] {
    const normalizedQuery = normalizeForMatching(query);
    const queryTokens = tokenize(query);

    let candidates = this.getLunrCandidates(normalizedQuery);
    const allowed = getAllowedDomains(hints);

    if (allowed) {
      candidates = candidates.filter((doc) => {
        const dom = String(doc.metadata?.domain || "unknown").toLowerCase().trim() || "unknown";
        return allowed.has(dom);
      });
    }

    if (candidates.length < DOMAIN_FILTER_MIN_CANDIDATES) {
      const backupIds = this.backfillCandidates(queryTokens, allowed);
      const candidateIds = new Set(candidates.map((d) => d.id));
      for (const id of backupIds) candidateIds.add(id);
      candidates = this.docs.filter((doc) => candidateIds.has(doc.id));
      if (allowed) {
        candidates = candidates.filter((doc) => {
          const dom = String(doc.metadata?.domain || "unknown").toLowerCase().trim() || "unknown";
          return allowed.has(dom);
        });
      }
    }

    return this.computeScores(candidates, queryTokens, hints);
  }

  private getLunrCandidates(normalizedQuery: string): DomainDoc[] {
    if (!this.lunrIndex || !normalizedQuery) return this.docs;
    try {
      const lunrResults = this.lunrIndex.search(normalizedQuery).slice(0, LUNR_CANDIDATE_LIMIT);
      const refs = new Set(lunrResults.map((r: any) => r.ref));
      return this.docs.filter((doc) => refs.has(doc.id));
    } catch {
      return this.docs;
    }
  }

  private backfillCandidates(queryTokens: string[], allowed: Set<string> | null): string[] {
    let backup = this.docs;
    if (allowed) {
      backup = this.docs.filter((doc) => {
        const dom = String(doc.metadata?.domain || "unknown").toLowerCase().trim() || "unknown";
        return allowed.has(dom);
      });
    }
    const globalBm25 = this.computeScores(backup, queryTokens, {});
    return globalBm25.slice(0, FALLBACK_BM25_LIMIT).map((r) => r.docId);
  }

  private computeScores(
    docs: DomainDoc[],
    queryTokens: string[],
    hints: RetrievalHints
  ): RankedResult[] {
    const scores = docs
      .map((doc) => {
        const docTokens = this.docTokensCache.get(doc.id) || [];
        const docLength = this.docLengthCache.get(doc.id) || 0;
        const bm25Score = this.calculateBM25Score(docTokens, queryTokens, docLength);
        if (bm25Score <= 0) return { docId: doc.id, score: 0 };

        const domain = String(doc.metadata?.domain || "").toLowerCase();
        const domainBoost = getDomainBoost(domain, hints);
        const titleTokens = tokenize(doc.title.toLowerCase());
        const titleMatchBonus = queryTokens.some((t) => titleTokens.includes(t)) ? 0.1 : 0;
        const finalScore = (bm25Score * domainBoost) + titleMatchBonus;
        return { docId: doc.id, score: finalScore };
      })
      .filter((r) => r.score > 0.001)
      .sort((a, b) => b.score - a.score);

    return scores.map((r, idx) => ({ ...r, rank: idx + 1 }));
  }

  private calculateBM25Score(docTokens: string[], queryTokens: string[], docLength: number): number {
    if (docLength === 0 || queryTokens.length === 0) return 0;

    const tfMap = new Map<string, number>();
    for (const token of docTokens) tfMap.set(token, (tfMap.get(token) || 0) + 1);

    let score = 0;
    for (const token of queryTokens) {
      const tf = tfMap.get(token) || 0;
      if (tf === 0) continue;
      const idf = this.idfCache.get(token) || 0;
      if (idf <= 0) continue;
      score += (idf * tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / this.avgDocLength)));
    }
    return score;
  }

  getBm25Params() {
    return { k1: BM25_K1, b: BM25_B };
  }

  hasIndex(): boolean {
    return this.lunrIndex !== null && this.docs.length > 0;
  }
}
