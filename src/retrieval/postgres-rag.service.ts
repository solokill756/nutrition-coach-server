import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { resolveRagEmbeddingModel } from "./rag-embedding-model";

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
  private readonly documentsTable = "rag_documents";
  private readonly jobsTable = "rag_ingest_jobs";
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) {
    this.enabled = String(this.config.get<string>("USE_POSTGRES_STORAGE") || "false").toLowerCase() === "true";
    this.dbSchema = this.config.get<string>("POSTGRES_SCHEMA") || "public";
    this.embeddingDim = Number(this.config.get<string>("RAG_EMBEDDING_DIM") || 1024);
    this.embeddingModel = resolveRagEmbeddingModel(this.config);
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
    // Single-flight: VectorService and RetrievalService both call this at boot. Two parallel
    // CREATE TABLE IF NOT EXISTS collide in Postgres (pg_type_typname_nsp_index), and the loser left
    // retrieval stuck in BM25-only mode. A failed run is cleared so a later call can retry.
    if (!this.schemaReady) {
      this.schemaReady = this.runEnsureSchema().catch((error) => {
        this.schemaReady = null;
        throw error;
      });
    }
    return this.schemaReady;
  }

  private async runEnsureSchema(): Promise<void> {
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

    const documentsTable = this.tableRef(this.documentsTable);
    const jobsTable = this.tableRef(this.jobsTable);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${documentsTable} (
        id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_url TEXT, original_filename TEXT,
        file_path TEXT, file_hash TEXT, title TEXT NOT NULL DEFAULT '', language TEXT,
        status TEXT NOT NULL DEFAULT 'pending', chunk_count INT NOT NULL DEFAULT 0, created_by BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_documents_source_url ON ${documentsTable}(source_url) WHERE source_url IS NOT NULL`
    );
    await this.pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_documents_pdf_hash ON ${documentsTable}(file_hash) WHERE source_type = 'pdf' AND file_hash IS NOT NULL`
    );

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${jobsTable} (
        id BIGSERIAL PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES ${documentsTable}(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued', stage TEXT, progress INT NOT NULL DEFAULT 0,
        error_message TEXT, warnings JSONB NOT NULL DEFAULT '[]'::jsonb, attempt INT NOT NULL DEFAULT 1,
        started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_rag_ingest_jobs_status_created ON ${jobsTable}(status, created_at)`
    );

    await this.pool.query(`
      ALTER TABLE ${chunksTable}
        ADD COLUMN IF NOT EXISTS chunk_key text,
        ADD COLUMN IF NOT EXISTS heading_path text,
        ADD COLUMN IF NOT EXISTS page_from int,
        ADD COLUMN IF NOT EXISTS page_to int,
        ADD COLUMN IF NOT EXISTS block_kind text DEFAULT 'text',
        ADD COLUMN IF NOT EXISTS image_path text,
        ADD COLUMN IF NOT EXISTS language text,
        ADD COLUMN IF NOT EXISTS domain text,
        ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS tag_scores jsonb DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
        ADD COLUMN IF NOT EXISTS is_manually_edited boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS source_content_hash text
    `);

    // NOT VALID: legacy chunk rows may reference doc_ids with no rag_documents row; new rows are still checked.
    await this.pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'fk_rag_chunks_doc_id' AND conrelid = '${chunksTable.replace(/'/g, "''")}'::regclass
        ) THEN
          ALTER TABLE ${chunksTable}
            ADD CONSTRAINT fk_rag_chunks_doc_id FOREIGN KEY (doc_id)
            REFERENCES ${documentsTable}(id) ON DELETE CASCADE NOT VALID;
        END IF;
      END $$
    `);

    // See: scripts/sql/patches/rag_embeddings_hnsw.sql
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${embeddingsTable} (
        id TEXT PRIMARY KEY REFERENCES ${chunksTable}(id) ON DELETE CASCADE,
        embedding vector(${this.embeddingDim}) NOT NULL,
        model TEXT NOT NULL DEFAULT '${this.embeddingModel.replace(/'/g, "''")}', content_hash TEXT,
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

    const dim = await this.checkEmbeddingDimension();
    if (!dim.ok) {
      console.error(
        `[POSTGRES] rag_embeddings.embedding has dimension ${dim.actual ?? "unknown"} but RAG_EMBEDDING_DIM=${dim.expected}. ` +
          `Run scripts/sql/rag-reset-embeddings-1024.sql (drops rag_embeddings) and restart so it is recreated with vector(${dim.expected}).`
      );
    }
  }

  async checkEmbeddingDimension(): Promise<{ ok: boolean; actual: number | null; expected: number }> {
    const expected = this.embeddingDim;
    if (!this.isEnabled()) return { ok: false, actual: null, expected };

    const result = await this.pool.query(
      `
        SELECT a.atttypmod AS atttypmod
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attname = 'embedding' AND NOT a.attisdropped
      `,
      [this.dbSchema, this.embeddingsTable]
    );
    const raw = result.rows?.[0]?.atttypmod;
    const actual = raw === undefined || raw === null || Number(raw) <= 0 ? null : Number(raw);
    return { ok: actual === expected, actual, expected };
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

  private toDoc(row: Record<string, any>): DomainDoc {
    const metadata = { ...this.toMetadata(row.metadata) } as Record<string, unknown> & { domain?: string };
    const domain = metadata.domain != null ? String(metadata.domain).trim() : "";
    const cat = metadata.category != null ? String(metadata.category).trim() : "";
    if (!domain && cat) {
      metadata.domain = cat;
    }
    const colDomain = row.domain != null ? String(row.domain).trim() : "";
    if (colDomain) {
      metadata.domain = colDomain;
    }
    const tags = this.toMetadata(row.tags);
    if (Object.keys(tags).length > 0) metadata.tags = tags;
    if (row.heading_path) metadata.heading_path = String(row.heading_path);
    if (row.page_from != null) metadata.page_from = Number(row.page_from);
    if (row.block_kind) metadata.block_kind = String(row.block_kind);
    if (row.source_url) metadata.link = String(row.source_url);
    const baseTitle = String(row.title || "");
    const headingPath = row.heading_path ? String(row.heading_path) : "";
    return {
      id: String(row.id),
      doc_id: row.doc_id ? String(row.doc_id) : undefined,
      source: String(row.source || ""),
      title: headingPath ? `${baseTitle} › ${headingPath}` : baseTitle,
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
    const documentsTable = this.tableRef(this.documentsTable);
    const result = await this.pool.query(
      `
        SELECT c.id, c.doc_id, c.source, c.title, c.content, c.metadata,
               c.heading_path, c.domain, c.tags, c.page_from, c.block_kind, d.source_url
        FROM ${chunksTable} c
        LEFT JOIN ${documentsTable} d ON d.id = c.doc_id
        WHERE c.is_active = true
        ORDER BY c.updated_at DESC, c.id ASC
      `
    );
    return result.rows.map((row: Record<string, any>) => this.toDoc(row));
  }
}