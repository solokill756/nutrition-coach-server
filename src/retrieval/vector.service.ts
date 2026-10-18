import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { PostgresRagService } from "./postgres-rag.service";

type EmbeddingCache = {
  version: string;
  model: string;
  generatedAt: string;
  vectorDim: number;
  docCount: number;
  // Map: docId -> vector
  embeddings: Record<string, number[]>;
  // Map: docId -> content signature
  signatures?: Record<string, string>;
};

type QueryEmbeddingCache = {
  query: string;
  embedding: number[];
  cachedAt: number;
};

const EMBED_BATCH_SIZE = 8;

@Injectable()
export class VectorService implements OnModuleInit {
  // Configuration
  private model = "bge-m3"; // RAG embedding model (RAG_EMBEDDING_MODEL)
  private embeddingDim = 1024; // RAG_EMBEDDING_DIM
  private foodModel = "nomic-embed-text"; // FOOD_EMBEDDING_MODEL (food search only)
  private ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  private cacheDir = ".vector-cache";
  private cacheFile = "embeddings_cache.json";
  private useChunking = false;
  private usePgvector = true;

  // Memory caches
  private docEmbeddings: Map<string, number[]> = new Map(); // docId -> vector
  private docSignatures: Map<string, string> = new Map(); // docId -> content hash
  private queryCache: Map<string, QueryEmbeddingCache> = new Map(); // query -> {embedding, cachedAt}
  private queryTTL = 5 * 60 * 1000; // 5 minutes

  // State tracking
  private isReady = false;
  private isPreComputing = false;

  constructor(
    private readonly config: ConfigService,
    private readonly postgresRagService: PostgresRagService
  ) {
    this.model = this.config.get<string>("RAG_EMBEDDING_MODEL") || this.model;
    this.embeddingDim = Number(this.config.get<string>("RAG_EMBEDDING_DIM")) || this.embeddingDim;
    this.foodModel = this.config.get<string>("FOOD_EMBEDDING_MODEL") || this.foodModel;
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
      console.warn(`[VECTOR] ⚠️ Cache load failed: ${error}. Will pre-compute on demand.`);
      this.isReady = false;
    }
  }

  /**
   * Pre-compute embeddings for all provided documents
   * Call this method when cache is missing or invalid
   */
  async preComputeAllEmbeddings(docs: Array<{ id: string; text: string }>): Promise<void> {
    await this.ensureEmbeddingsForDocuments(docs);
  }

  /**
   * Incremental sync:
   * - Add embeddings for new docs
   * - Update embeddings when doc content changed
   * - Remove stale embeddings not present in latest corpus
   */
  async ensureEmbeddingsForDocuments(
    docs: Array<{ id: string; text: string }>
  ): Promise<{ added: number; updated: number; removed: number; skipped: number; failed: number }> {
    if (this.usePgvector && this.postgresRagService.isEnabled()) {
      if (this.isPreComputing) {
        console.warn("[VECTOR] ⚠️ Sync skipped: pre-compute in progress");
        return { added: 0, updated: 0, removed: 0, skipped: docs.length, failed: 0 };
      }

      this.isPreComputing = true;
      try {
        const normalizedDocs = docs.map((doc) => {
          const normalizedText = doc.text.substring(0, 2000).trim();
          return {
            id: doc.id,
            text: normalizedText,
            signature: this.computeSignature(normalizedText)
          };
        });

        const existingHashes = await this.postgresRagService.getChunkEmbeddingHashes(
          normalizedDocs.map((doc) => doc.id)
        );

        const toGenerate = normalizedDocs.filter((doc) => existingHashes.get(doc.id) !== doc.signature);
        const skipped = normalizedDocs.length - toGenerate.length;

        const upsertRows: Array<{ id: string; contentHash: string; embedding: number[] }> = [];
        let failed = 0;
        const batchSize = Number(this.config.get<string>("POSTGRES_EMBEDDING_BATCH_SIZE") || 25);

        for (let i = 0; i < toGenerate.length; i += batchSize) {
          const batch = toGenerate.slice(i, i + batchSize);
          const results = await Promise.allSettled(
            batch.map(async (item) => {
              const embedding = await this.generateEmbedding(item.text);
              return {
                id: item.id,
                contentHash: item.signature,
                embedding
              };
            })
          );

          for (const result of results) {
            if (result.status === "fulfilled") {
              upsertRows.push(result.value);
            } else {
              failed++;
              console.error("[VECTOR] ❌ Incremental upsert failed:", result.reason);
            }
          }
        }

        const dbStats = await this.postgresRagService.syncChunkEmbeddings(
          upsertRows,
          normalizedDocs.map((doc) => doc.id)
        );

        const stats = {
          added: dbStats.added,
          updated: dbStats.updated,
          removed: dbStats.removed,
          skipped,
          failed: failed + dbStats.failed
        };

        this.isReady = true;
        console.log(
          `[VECTOR] ✅ Incremental sync done: +${stats.added} new, ~${stats.updated} updated, -${stats.removed} removed, ${stats.skipped} unchanged, ${stats.failed} failed`
        );
        return stats;
      } catch (error) {
        this.isReady = false;
        console.error("[VECTOR] ❌ Pgvector sync failed:", error);
        return { added: 0, updated: 0, removed: 0, skipped: 0, failed: docs.length };
      } finally {
        this.isPreComputing = false;
      }
    }

    if (this.isPreComputing) {
      console.warn("[VECTOR] ⚠️ Sync skipped: pre-compute in progress");
      return { added: 0, updated: 0, removed: 0, skipped: docs.length, failed: 0 };
    }

    const incomingIds = new Set(docs.map((d) => d.id));
    let removed = 0;

    // Remove stale vectors that are no longer in corpus
    for (const docId of Array.from(this.docEmbeddings.keys())) {
      if (!incomingIds.has(docId)) {
        this.docEmbeddings.delete(docId);
        this.docSignatures.delete(docId);
        removed++;
      }
    }

    const toUpsert: Array<{ id: string; text: string; signature: string; isNew: boolean }> = [];
    let skipped = 0;

    for (const doc of docs) {
      const normalizedText = doc.text.substring(0, 2000).trim();
      const signature = this.computeSignature(normalizedText);
      const existingSignature = this.docSignatures.get(doc.id);
      const hasEmbedding = this.docEmbeddings.has(doc.id);

      if (!hasEmbedding) {
        toUpsert.push({ id: doc.id, text: normalizedText, signature, isNew: true });
      } else if (!existingSignature) {
        // Backfill signature for legacy caches without forcing costly full re-embedding.
        this.docSignatures.set(doc.id, signature);
        skipped++;
      } else if (existingSignature !== signature) {
        toUpsert.push({ id: doc.id, text: normalizedText, signature, isNew: false });
      } else {
        skipped++;
      }
    }

    let added = 0;
    let updated = 0;
    let failed = 0;

    if (toUpsert.length > 0) {
      console.log(`[VECTOR] 🔄 Incremental sync: upserting ${toUpsert.length} embeddings...`);
      const batchSize = 25;
      for (let i = 0; i < toUpsert.length; i += batchSize) {
        const batch = toUpsert.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (item) => {
            const vector = await this.generateEmbedding(item.text);
            this.docEmbeddings.set(item.id, vector);
            this.docSignatures.set(item.id, item.signature);
            return item;
          })
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            if (result.value.isNew) {
              added++;
            } else {
              updated++;
            }
          } else {
            failed++;
            console.error("[VECTOR] ❌ Incremental upsert failed:", result.reason);
          }
        }
      }
    }

    await this.saveCacheToDisk();
    this.isReady = this.docEmbeddings.size > 0;

    console.log(
      `[VECTOR] ✅ Incremental sync done: +${added} new, ~${updated} updated, -${removed} removed, ${skipped} unchanged, ${failed} failed`
    );

    return { added, updated, removed, skipped, failed };
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
  async getQueryEmbedding(query: string): Promise<number[]> {
    const text = this.normalizeForRag(query);
    // Check query cache (TTL: 5 minutes)
    const cached = this.queryCache.get(text);
    if (cached && Date.now() - cached.cachedAt < this.queryTTL) {
      return cached.embedding;
    }

    // Generate and cache
    try {
      const embedding = await this.generateEmbedding(text);
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
      isPreComputing: this.isPreComputing,
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
    this.docSignatures.clear();
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
  private async generateEmbedding(text: string): Promise<number[]> {
    const [embedding] = await this.embedDocuments([text]);
    return embedding;
  }

  /**
   * Embed RAG texts in sequential batches (bge-m3 via Ollama /api/embed).
   * Text is only NFC-normalized and trimmed: diacritics and case are kept.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const input = texts.slice(i, i + EMBED_BATCH_SIZE).map((t) => this.normalizeForRag(t));
      out.push(...(await this.requestEmbedBatch(input)));
    }
    return out;
  }

  private normalizeForRag(value: string): string {
    return String(value ?? "").normalize("NFC").trim();
  }

  private async requestEmbedBatch(input: string[]): Promise<number[][]> {
    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input })
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
   * Save embeddings to disk cache
   */
  private async saveCacheToDisk(): Promise<void> {
    try {
      // Create cache directory if not exists
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }

      const cache: EmbeddingCache = {
        version: "1.1",
        model: this.model,
        generatedAt: new Date().toISOString(),
        vectorDim: this.embeddingDim,
        docCount: this.docEmbeddings.size,
        embeddings: Object.fromEntries(this.docEmbeddings),
        signatures: Object.fromEntries(this.docSignatures)
      };

      const filePath = path.join(this.cacheDir, this.cacheFile);
      fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), "utf8");

      console.log(
        `[VECTOR] 💾 Saved ${this.docEmbeddings.size} embeddings to ${filePath}`
      );
    } catch (error) {
      console.error("[VECTOR] ❌ Cache save error:", error);
      throw error;
    }
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
      this.docSignatures = new Map(Object.entries(cache.signatures || {}));

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

  private computeSignature(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }
}
