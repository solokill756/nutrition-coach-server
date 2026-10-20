export type DomainDoc = {
  id: string;
  source: string;
  title: string;
  content: string;
  metadata: Record<string, unknown> & { domain?: string };
  doc_id?: string;
};

export type RetrievalResult = {
  id: string;
  source: string;
  title: string;
  content: string;
  domain: string;
  score: number;
  link?: string;
  /** First PDF page of the chunk. */
  page?: number;
  /** "text" | "table" | "image": how the chunk was extracted. */
  blockKind?: string;
  isChunk?: boolean;
  parentId?: string;
  chunkIndex?: number;
  chunkTotal?: number;
};

export type HybridSearchMode = "bm25-only" | "vector-only" | "hybrid";
export type QueryIntent = "food_specific" | "condition_specific" | "safety" | "general";

export type RetrievalHints = {
  intent?: QueryIntent;
  hasConditionContext?: boolean;
  skipExpansion?: boolean;
  skipCrossEncoder?: boolean;
  foods?: string[];
  conditions?: string[];
};

export type RankedResult = { docId: string; score: number; rank: number };
