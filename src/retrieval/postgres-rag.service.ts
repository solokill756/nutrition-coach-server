import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Pool } = require("pg");

type DomainDoc = {
  id: string;
  source: string;
  title: string;
  content: string;
  metadata: Record<string, unknown> & { domain?: string };
  doc_id?: string;
};

type CorpusPayload = {
  docs: DomainDoc[];
};

type EmbeddingSyncStats = {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  failed: number;
};

@Injectable()
export class PostgresRagService implements OnModuleDestroy {
  private readonly enabled: boolean;
  private readonly pool: any | null;
  private readonly dbSchema: string;
  private readonly embeddingDim: number;
  private readonly embeddingModel: string;
  private readonly vectorIndexType: string;
  private readonly chunksTable = "rag_chunks";
  private readonly embeddingsTable = "rag_embeddings";

  constructor(private readonly config: ConfigService) {
    this.enabled = String(this.config.get<string>("USE_POSTGRES_STORAGE") || "false").toLowerCase() === "true";
    this.dbSchema = this.config.get<string>("POSTGRES_SCHEMA") || "public";
    this.embeddingDim = Number(this.config.get<string>("POSTGRES_VECTOR_DIM") || 384);
    this.embeddingModel = this.config.get<string>("POSTGRES_EMBEDDING_MODEL") || "nomic-embed-text";
    this.vectorIndexType = String(this.config.get<string>("POSTGRES_VECTOR_INDEX_TYPE") || "hnsw").toLowerCase();
    this.pool = this.enabled ? new Pool(this.buildPoolConfig()) : null;
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  isEnabled(): boolean {
    return this.enabled && !!this.pool;
  }

  async loadCorpus(): Promise<CorpusPayload> {
    if (!this.isEnabled()) {
      return { docs: [] };
    }

    return { docs: await this.loadChunks() };
  }

  /**
   * Auto-provision RAG tables + indexes at boot.
   * For production deployments, use scripts/sql/provision-rag-tables.sql
   * and scripts/sql/patches/rag_embeddings_hnsw.sql instead.
   */
  async ensureSchema(): Promise<void> {
    if (!this.isEnabled()) return;

    const chunksTable = this.tableRef(this.chunksTable);
    const embeddingsTable = this.tableRef(this.embeddingsTable);

    try {
      await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    } catch (error: any) {
      throw new Error(
        `pgvector extension unavailable. Install pgvector first. Original: ${error?.message || String(error)}`
      );
    }

    // See: scripts/sql/provision-rag-tables.sql
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${chunksTable} (
        id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb, content_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // See: scripts/sql/patches/rag_embeddings_hnsw.sql
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${embeddingsTable} (
        id TEXT PRIMARY KEY REFERENCES ${chunksTable}(id) ON DELETE CASCADE,
        embedding vector(${this.embeddingDim}) NOT NULL,
        model TEXT NOT NULL DEFAULT 'nomic-embed-text', content_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc_id ON ${chunksTable}(doc_id)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_rag_chunks_domain ON ${chunksTable}((metadata->>'domain'))`);

    if (this.vectorIndexType === "ivfflat") {
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_rag_embeddings_vector_ivfflat
        ON ${embeddingsTable} USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
      `);
    } else {
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_rag_embeddings_vector_hnsw
        ON ${embeddingsTable} USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)
      `);
    }

    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_rag_embeddings_updated_at ON ${embeddingsTable}(updated_at DESC)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_rag_embeddings_model ON ${embeddingsTable}(model)`);

  }

  async syncChunkEmbeddings(
    records: Array<{ id: string; contentHash: string; embedding: number[] }>,
    activeIds: string[]
  ): Promise<EmbeddingSyncStats> {
    if (!this.isEnabled()) {
      return { added: 0, updated: 0, removed: 0, skipped: 0, failed: records.length };
    }

    const embeddingsTable = this.tableRef(this.embeddingsTable);
    if (records.length === 0) {
      const removedOnly = await this.deleteStaleEmbeddings(embeddingsTable, activeIds);
      return { added: 0, updated: 0, removed: removedOnly, skipped: 0, failed: 0 };
    }

    const existingHashes = await this.getEmbeddingHashes(records.map((record) => record.id));
    const toUpsert = records.filter((record) => existingHashes.get(record.id) !== record.contentHash);
    const skipped = records.length - toUpsert.length;
    const removed = await this.deleteStaleEmbeddings(embeddingsTable, activeIds);

    let added = 0;
    let updated = 0;
    let failed = 0;
    const batchSize = Number(this.config.get<string>("POSTGRES_EMBEDDING_BATCH_SIZE") || 25);

    for (let i = 0; i < toUpsert.length; i += batchSize) {
      const batch = toUpsert.slice(i, i + batchSize);
      try {
        await this.upsertEmbeddingBatch(embeddingsTable, batch);
        for (const row of batch) {
          if (existingHashes.has(row.id)) {
            updated++;
          } else {
            added++;
          }
        }
      } catch (error) {
        failed += batch.length;
        console.error("[POSTGRES] ❌ Embedding batch upsert failed:", error);
      }
    }

    return { added, updated, removed, skipped, failed };
  }

  async getChunkEmbeddingHashes(ids: string[]): Promise<Map<string, string>> {
    if (!this.isEnabled()) {
      return new Map();
    }
    return this.getEmbeddingHashes(ids);
  }

  async vectorSearchByDocIds(
    queryEmbedding: number[],
    docIds: string[],
    topK: number
  ): Promise<Array<{ docId: string; score: number }>> {
    if (!this.isEnabled() || docIds.length === 0) {
      return [];
    }

    const embeddingsTable = this.tableRef(this.embeddingsTable);
    const result = await this.pool.query(
      `
        SELECT id, (1 - (embedding <=> $1::vector)) AS score
        FROM ${embeddingsTable}
        WHERE id = ANY($2::text[])
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `,
      [this.vectorLiteral(queryEmbedding), docIds, topK]
    );

    return result.rows.map((row: Record<string, any>) => ({
      docId: String(row.id),
      score: Math.max(0, Number(row.score || 0))
    }));
  }

  async vectorSearchAll(
    queryEmbedding: number[],
    topK: number
  ): Promise<Array<{ docId: string; score: number }>> {
    if (!this.isEnabled()) {
      return [];
    }

    const embeddingsTable = this.tableRef(this.embeddingsTable);
    const result = await this.pool.query(
      `
        SELECT id, (1 - (embedding <=> $1::vector)) AS score
        FROM ${embeddingsTable}
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `,
      [this.vectorLiteral(queryEmbedding), topK]
    );

    return result.rows.map((row: Record<string, any>) => ({
      docId: String(row.id),
      score: Math.max(0, Number(row.score || 0))
    }));
  }

  private buildPoolConfig() {
    const connectionString = this.config.get<string>("DATABASE_URL") || this.config.get<string>("POSTGRES_URL") || undefined;

    if (connectionString) {
      return {
        connectionString,
        ssl: this.parseBoolean(this.config.get<string>("POSTGRES_SSL"), false) ? { rejectUnauthorized: false } : undefined
      };
    }

    return {
      host: this.config.get<string>("POSTGRES_HOST") || "localhost",
      port: Number(this.config.get<string>("POSTGRES_PORT") || 5432),
      user: this.config.get<string>("POSTGRES_USER") || "postgres",
      password: this.config.get<string>("POSTGRES_PASSWORD") || "postgres",
      database: this.config.get<string>("POSTGRES_DB") || "nutrition_rag",
      ssl: this.parseBoolean(this.config.get<string>("POSTGRES_SSL"), false) ? { rejectUnauthorized: false } : undefined,
      max: Number(this.config.get<string>("POSTGRES_POOL_MAX") || 10),
      connectionTimeoutMillis: Number(this.config.get<string>("POSTGRES_CONNECTION_TIMEOUT_MS") || 5000)
    };
  }

  private parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
      return fallback;
    }

    return String(value).toLowerCase() === "true";
  }

  private quoteIdent(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid SQL identifier: ${name}`);
    }
    return `"${name}"`;
  }

  private tableRef(tableName: string): string {
    return `${this.quoteIdent(this.dbSchema)}.${this.quoteIdent(tableName)}`;
  }

  private vectorLiteral(embedding: number[]): string {
    return `[${embedding.join(",")}]`;
  }

  private async getEmbeddingHashes(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }

    const embeddingsTable = this.tableRef(this.embeddingsTable);
    const result = await this.pool.query(
      `SELECT id, content_hash FROM ${embeddingsTable} WHERE id = ANY($1::text[])`,
      [ids]
    );

    return new Map(result.rows.map((row: Record<string, any>) => [String(row.id), String(row.content_hash || "")]));
  }

  private async deleteStaleEmbeddings(embeddingsTable: string, activeIds: string[]): Promise<number> {
    if (activeIds.length === 0) {
      const result = await this.pool.query(`DELETE FROM ${embeddingsTable}`);
      return result.rowCount || 0;
    }

    const result = await this.pool.query(
      `DELETE FROM ${embeddingsTable} WHERE NOT (id = ANY($1::text[]))`,
      [activeIds]
    );
    return result.rowCount || 0;
  }

  private async upsertEmbeddingBatch(
    embeddingsTable: string,
    rows: Array<{ id: string; contentHash: string; embedding: number[] }>
  ): Promise<void> {
    const values: Array<string> = [];
    const placeholders: string[] = [];

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const offset = idx * 4;
      values.push(row.id, this.vectorLiteral(row.embedding), row.contentHash, this.embeddingModel);
      placeholders.push(`($${offset + 1}, $${offset + 2}::vector, $${offset + 3}, $${offset + 4}, NOW())`);
    }

    await this.pool.query(
      `
        INSERT INTO ${embeddingsTable} (id, embedding, content_hash, model, updated_at)
        VALUES ${placeholders.join(",\n")}
        ON CONFLICT (id) DO UPDATE SET
          embedding = EXCLUDED.embedding,
          content_hash = EXCLUDED.content_hash,
          model = EXCLUDED.model,
          updated_at = NOW()
      `,
      values
    );
  }

  private toDoc(row: Record<string, any>): DomainDoc {
    const metadata = { ...this.toMetadata(row.metadata) } as Record<string, unknown> & { domain?: string };
    const domain = metadata.domain != null ? String(metadata.domain).trim() : "";
    const cat = metadata.category != null ? String(metadata.category).trim() : "";
    if (!domain && cat) {
      metadata.domain = cat;
    }
    return {
      id: String(row.id),
      doc_id: row.doc_id ? String(row.doc_id) : undefined,
      source: String(row.source || ""),
      title: String(row.title || ""),
      content: String(row.content || ""),
      metadata
    };
  }

  private toMetadata(value: unknown): Record<string, unknown> & { domain?: string } {
    if (!value) {
      return {};
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown> & { domain?: string };
    }

    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown> & { domain?: string };
        }
      } catch {
        return {};
      }
    }

    return {};
  }

  private async loadChunks(): Promise<DomainDoc[]> {
    const chunksTable = this.tableRef(this.chunksTable);
    const result = await this.pool.query(
      `SELECT id, doc_id, source, title, content, metadata FROM ${chunksTable} ORDER BY updated_at DESC, id ASC`
    );
    return result.rows.map((row: Record<string, any>) => this.toDoc(row));
  }
}