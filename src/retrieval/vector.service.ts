import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { PostgresRagService } from "./postgres-rag.service";
import { resolveRagEmbeddingModel } from "./rag-embedding-model";

type EmbeddingCache = {
  version: string;
  model: string;
  generatedAt: string;
  vectorDim: number;
  docCount: number;
  // Map: docId -> vector
  embeddings: Record<string, number[]>;
};

type QueryEmbeddingCache = {
  query: string;
  embedding: number[];
  cachedAt: number;
};

/** RAG_INGEST_EMBED_BATCH_SIZE default: one text per request, so a user query can slip in between ingest chunks. */
const DEFAULT_EMBED_BATCH_SIZE = 1;

/**
 * OLLAMA_KEEP_ALIVE default: keep the RAG model loaded. Ollama unloads idle models after 5 min,
 * and reloading bge-m3 (~3 s) exceeds the query-embedding timeout, dropping retrieval to BM25 only.
 */
const DEFAULT_KEEP_ALIVE = "-1";

/** Ollama takes keep_alive as seconds (number, negative = forever) or a duration string such as "30m". */
function parseKeepAlive(raw: string | undefined): number | string {
  const value = String(raw ?? "").trim() || DEFAULT_KEEP_ALIVE;
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

@Injectable()
export class VectorService implements OnModuleInit {
  // Configuration
  private model = "bge-m3"; // RAG embedding model (RAG_EMBEDDING_MODEL)
  private embeddingDim = 1024; // RAG_EMBEDDING_DIM
  private foodModel = "nomic-embed-text"; // FOOD_EMBEDDING_MODEL (food search only)
  private embedBatchSize = DEFAULT_EMBED_BATCH_SIZE; // RAG_INGEST_EMBED_BATCH_SIZE
  private keepAlive: number | string; // OLLAMA_KEEP_ALIVE
  private ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  private cacheDir = ".vector-cache";
  private cacheFile = "embeddings_cache.json";
  private useChunking = false;
  private usePgvector = true;

  // Memory caches
  private docEmbeddings: Map<string, number[]> = new Map(); // docId -> vector
  private queryCache: Map<string, QueryEmbeddingCache> = new Map(); // query -> {embedding, cachedAt}
  private queryTTL = 5 * 60 * 1000; // 5 minutes

  // State tracking
  private isReady = false;

  constructor(
    private readonly config: ConfigService,
    private readonly postgresRagService: PostgresRagService
  ) {
    this.model = resolveRagEmbeddingModel(this.config);
    this.embeddingDim = Number(this.config.get<string>("RAG_EMBEDDING_DIM")) || this.embeddingDim;
    this.foodModel = this.config.get<string>("FOOD_EMBEDDING_MODEL") || this.foodModel;
    const batch = Math.floor(Number(this.config.get<string>("RAG_INGEST_EMBED_BATCH_SIZE")));
    this.embedBatchSize = batch > 0 ? batch : DEFAULT_EMBED_BATCH_SIZE;
    this.keepAlive = parseKeepAlive(this.config.get<string>("OLLAMA_KEEP_ALIVE"));
  }

  async onModuleInit() {
    try {
      this.useChunking = String(this.config.get<string>("USE_CHUNKING") || "false").toLowerCase() === "true";
      this.usePgvector = String(this.config.get<string>("POSTGRES_ENABLE_PGVECTOR") || "true").toLowerCase() === "true";
      this.cacheFile = this.useChunking ? "embeddings_cache.chunked.json" : "embeddings_cache.json";

      if (this.usePgvector && this.postgresRagService.isEnabled()) {
        await this.postgresRagService.ensureSchema();
        this.isReady = true;
        console.log("[VECTOR] ✅ Service initialized with pgvector storage");
      } else {
        await this.loadCacheFromDisk();
        this.isReady = true;
        console.log(
          `[VECTOR] ✅ Service initialized with ${this.docEmbeddings.size} cached embeddings`
        );
      }
    } catch (error) {
      console.warn(`[VECTOR] ⚠️ Cache load failed: ${error}`);
      this.isReady = false;
    }
    // Not awaited: startup must not wait for (or fail on) Ollama.
    void this.warmUpRagModel();
  }

  /** Loads the RAG model into Ollama so the first user query does not pay the model load time. */
  private async warmUpRagModel(): Promise<void> {
    try {
      await this.requestEmbedBatch(["warm-up"]);
    } catch (error) {
      console.warn(`[VECTOR] ⚠️ RAG embedding model warm-up failed: ${error}`);
    }
  }

  /**
   * Get embedding for a document (from cache or generate)
   */
  async embedDocument(text: string, docId?: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error("Text cannot be empty");
    }

    // Try cache first (legacy mode only)
    if (!this.usePgvector && docId && this.docEmbeddings.has(docId)) {
      return this.docEmbeddings.get(docId)!;
    }

    // Generate embedding via Ollama
    try {
      const embedding = await this.generateEmbedding(text);

      // Store in memory cache only in legacy mode
      if (!this.usePgvector && docId) {
        this.docEmbeddings.set(docId, embedding);
      }

      return embedding;
    } catch (error) {
      console.error("[VECTOR] ❌ Embedding generation failed:", error);
      throw error;
    }
  }

  /**
   * Get cached embedding without generating new one
   */
  getCachedEmbedding(docId: string): number[] | null {
    if (this.docEmbeddings.has(docId)) {
      return this.docEmbeddings.get(docId)!;
    }
    return null;
  }

  /**
   * Get embedding for a query (with short TTL cache)
   */
  async getQueryEmbedding(query: string, signal?: AbortSignal): Promise<number[]> {
    const text = this.normalizeForRag(query);
    // Check query cache (TTL: 5 minutes)
    const cached = this.queryCache.get(text);
    if (cached && Date.now() - cached.cachedAt < this.queryTTL) {
      return cached.embedding;
    }

    // Generate and cache
    try {
      const embedding = await this.generateEmbedding(text, signal);
      this.queryCache.set(text, {
        query: text,
        embedding,
        cachedAt: Date.now()
      });

      // Cleanup old entries
      this.cleanupQueryCache();

      return embedding;
    } catch (error) {
      console.error("[VECTOR] ❌ Query embedding failed:", error);
      throw error;
    }
  }

  /**
   * Get embedding for a batch of texts
   */
  async getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    return this.embedDocuments(texts);
  }

  /**
   * Cosine similarity: range [0, 1] where 1 = identical
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error("Vector dimensions must match");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    // Normalize to [0, 1]
    const cosine = dotProduct / denominator;
    return (cosine + 1) / 2; // Convert from [-1, 1] to [0, 1]
  }

  /**
   * Vector search: find similar documents
   */
  async vectorSearch(
    queryEmbedding: number[],
    docIds: string[],
    topK: number = 10
  ): Promise<Array<{ docId: string; score: number }>> {
    if (this.usePgvector && this.postgresRagService.isEnabled()) {
      return this.postgresRagService.vectorSearchByDocIds(queryEmbedding, docIds, topK);
    }

    const scores = docIds
      .map((docId) => {
        const docEmbedding = this.docEmbeddings.get(docId);
        if (!docEmbedding) return null;

        const similarity = this.cosineSimilarity(queryEmbedding, docEmbedding);
        return { docId, score: similarity };
      })
      .filter((r) => r !== null) as Array<{ docId: string; score: number }>;

    return scores.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Global vector search across all indexed embeddings.
   */
  vectorSearchAll(
    queryEmbedding: number[],
    topK: number = 50
  ): Promise<Array<{ docId: string; score: number }>> {
    if (this.usePgvector && this.postgresRagService.isEnabled()) {
      return this.postgresRagService.vectorSearchAll(queryEmbedding, topK);
    }

    const allDocIds = Array.from(this.docEmbeddings.keys());
    if (allDocIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.vectorSearch(queryEmbedding, allDocIds, topK);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      model: this.model,
      embeddingDim: this.embeddingDim,
      docEmbeddingsCount: this.usePgvector ? -1 : this.docEmbeddings.size,
      queryCacheSize: this.queryCache.size,
      isReady: this.isReady,
      useChunking: this.useChunking,
      cacheFile: this.cacheFile,
      usePgvector: this.usePgvector
    };
  }

  /**
   * Document embeddings are stored in Postgres (not in getCachedEmbedding memory map).
   */
  docEmbeddingsInPostgres(): boolean {
    return this.usePgvector && this.postgresRagService.isEnabled();
  }

  /**
   * Check if service is ready
   */
  isServiceReady(): boolean {
    if (this.usePgvector && this.postgresRagService.isEnabled()) {
      return this.isReady;
    }

    return this.isReady && this.docEmbeddings.size > 0;
  }

  /**
   * Force rebuild embeddings
   */
  async clearEmbeddings(): Promise<void> {
    this.docEmbeddings.clear();
    this.queryCache.clear();
    this.isReady = false;
    
    const cacheFilePath = path.join(this.cacheDir, this.cacheFile);
    if (fs.existsSync(cacheFilePath)) {
      fs.unlinkSync(cacheFilePath);
      console.log("[VECTOR] 🗑️ Embeddings cleared");
    }
  }

  // ===== PRIVATE METHODS =====

  /**
   * Generate embedding via Ollama API
   */
  private async generateEmbedding(text: string, signal?: AbortSignal): Promise<number[]> {
    const [embedding] = await this.requestEmbedBatch([this.normalizeForRag(text)], signal);
    return embedding;
  }

  /**
   * Embed RAG texts in sequential batches of RAG_INGEST_EMBED_BATCH_SIZE (default 1;
   * bge-m3 via Ollama /api/embed), so user queries are not stuck behind a large ingest batch.
   * Text is only NFC-normalized and trimmed: diacritics and case are kept.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.embedBatchSize) {
      const input = texts.slice(i, i + this.embedBatchSize).map((t) => this.normalizeForRag(t));
      out.push(...(await this.requestEmbedBatch(input)));
    }
    return out;
  }

  private normalizeForRag(value: string): string {
    return String(value ?? "").normalize("NFC").trim();
  }

  private async requestEmbedBatch(input: string[], signal?: AbortSignal): Promise<number[][]> {
    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input, keep_alive: this.keepAlive }),
        ...(signal ? { signal } : {})
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { embeddings: number[][] };
      if (!Array.isArray(data.embeddings) || data.embeddings.length !== input.length) {
        throw new Error("Invalid embedding response format");
      }
      return data.embeddings;
    } catch (error) {
      console.error("[VECTOR] ❌ Ollama embedding error:", error);
      throw new Error(`Failed to generate embedding: ${error}`);
    }
  }

  /**
   * Embedding for food search: separate model, legacy single-prompt endpoint,
   * ASCII-folded text (matches how food_embeddings were generated).
   */
  async getFoodQueryEmbedding(query: string): Promise<number[]> {
    const prompt = this.normalizeForEmbedding(query).substring(0, 2000).trim();

    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.foodModel,
          prompt,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { embedding: number[] };

      if (!Array.isArray(data.embedding)) {
        throw new Error("Invalid embedding response format");
      }

      return data.embedding;
    } catch (error) {
      console.error("[VECTOR] ❌ Ollama embedding error:", error);
      throw new Error(`Failed to generate embedding: ${error}`);
    }
  }

  private normalizeForEmbedding(value: any): string {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Load embeddings from disk cache
   */
  private async loadCacheFromDisk(): Promise<void> {
    try {
      const filePath = path.join(this.cacheDir, this.cacheFile);

      if (!fs.existsSync(filePath)) {
        throw new Error("Cache file not found");
      }

      const data = fs.readFileSync(filePath, "utf8");
      const cache: EmbeddingCache = JSON.parse(data);

      // Validate cache
      if (cache.version !== "1.0" && cache.version !== "1.1") {
        throw new Error("Cache version mismatch");
      }

      if (cache.model !== this.model) {
        throw new Error(`Cache model mismatch: ${cache.model} vs ${this.model}`);
      }

      if (cache.vectorDim !== this.embeddingDim) {
        throw new Error(
          `Vector dimension mismatch: ${cache.vectorDim} vs ${this.embeddingDim}`
        );
      }

      // Load embeddings
      this.docEmbeddings = new Map(Object.entries(cache.embeddings));

      console.log(
        `[VECTOR] 📂 Loaded ${this.docEmbeddings.size} embeddings from cache`
      );
    } catch (error) {
      console.error("[VECTOR] ❌ Cache load error:", error);
      throw error;
    }
  }

  /**
   * Cleanup old query cache entries (keep only recent 1000)
   */
  private cleanupQueryCache(): void {
    if (this.queryCache.size > 1000) {
      const entries = Array.from(this.queryCache.entries())
        .sort((a, b) => b[1].cachedAt - a[1].cachedAt)
        .slice(0, 500); // Keep top 500

      this.queryCache = new Map(entries);
    }
  }
}
