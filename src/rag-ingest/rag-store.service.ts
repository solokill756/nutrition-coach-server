import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { DataSource } from "typeorm";
import { ChunkMergePlan, ExistingChunkState, planChunkMerge } from "./chunk-merge-planner";
import { DraftChunk } from "./rag-ingest.types";
import { RagDomain, RagTags } from "./rag-taxonomy";

export type RagDocumentRow = {
  id: string;
  sourceType: "url" | "pdf";
  sourceUrl: string | null;
  originalFilename: string | null;
  filePath: string | null;
  fileHash: string | null;
  title: string;
  language: string | null;
  status: string;
  chunkCount: number;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RagJobRow = {
  id: string;
  documentId: string;
  status: string;
  stage: string | null;
  progress: number;
  errorMessage: string | null;
  warnings: string[];
  attempt: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

export type RagChunkRow = {
  id: string;
  docId: string;
  chunkKey: string | null;
  source: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  contentHash: string | null;
  headingPath: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  blockKind: string | null;
  imagePath: string | null;
  language: string | null;
  domain: string | null;
  tags: Record<string, unknown>;
  tagScores: Record<string, number>;
  isActive: boolean;
  isManuallyEdited: boolean;
  needsReview: boolean;
  sourceContentHash: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ReadyChunk = DraftChunk & {
  id: string;
  domain: RagDomain;
  tags: RagTags;
  tagScores: Record<string, number>;
  tagger: string | null;
  tagFailed: boolean;
  imagePath: string | null;
  embedding: number[];
  embeddingHash: string;
};

export type ApplyIngestInput = {
  title: string;
  language: "en" | "vi" | "mixed";
  chunks: ReadyChunk[];
  draftKeys: { chunkKey: string; sourceContentHash: string }[];
};

type Row = Record<string, any>;
type QueryFn = (sql: string, params?: unknown[]) => Promise<any>;

const DOCUMENT_PATCH_COLUMNS: Record<string, string> = {
  title: "title",
  filePath: "file_path",
  status: "status",
  language: "language",
  chunkCount: "chunk_count",
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** TypeORM returns [rows, affectedCount] for UPDATE/DELETE ... RETURNING; plain rows otherwise. */
function rowsOf(result: any): Row[] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === "number") {
    return result[0];
  }
  return Array.isArray(result) ? result : [];
}

function toDocument(r: Row): RagDocumentRow {
  return {
    id: r.id,
    sourceType: r.source_type,
    sourceUrl: r.source_url ?? null,
    originalFilename: r.original_filename ?? null,
    filePath: r.file_path ?? null,
    fileHash: r.file_hash ?? null,
    title: r.title,
    language: r.language ?? null,
    status: r.status,
    chunkCount: Number(r.chunk_count ?? 0),
    createdBy: r.created_by === null || r.created_by === undefined ? null : Number(r.created_by),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toJob(r: Row): RagJobRow {
  return {
    id: String(r.id),
    documentId: r.document_id,
    status: r.status,
    stage: r.stage ?? null,
    progress: Number(r.progress ?? 0),
    errorMessage: r.error_message ?? null,
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
    attempt: Number(r.attempt ?? 1),
    startedAt: r.started_at ?? null,
    finishedAt: r.finished_at ?? null,
    createdAt: r.created_at,
  };
}

function toChunk(r: Row): RagChunkRow {
  return {
    id: r.id,
    docId: r.doc_id,
    chunkKey: r.chunk_key ?? null,
    source: r.source ?? "",
    title: r.title ?? "",
    content: r.content,
    metadata: r.metadata ?? {},
    contentHash: r.content_hash ?? null,
    headingPath: r.heading_path ?? null,
    pageFrom: r.page_from ?? null,
    pageTo: r.page_to ?? null,
    blockKind: r.block_kind ?? null,
    imagePath: r.image_path ?? null,
    language: r.language ?? null,
    domain: r.domain ?? null,
    tags: r.tags ?? {},
    tagScores: r.tag_scores ?? {},
    isActive: r.is_active !== false,
    isManuallyEdited: r.is_manually_edited === true,
    needsReview: r.needs_review === true,
    sourceContentHash: r.source_content_hash ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toExistingState(r: Row): ExistingChunkState {
  return {
    id: r.id,
    chunkKey: r.chunk_key,
    sourceContentHash: r.source_content_hash ?? null,
    isManuallyEdited: r.is_manually_edited === true,
  };
}

@Injectable()
export class RagStoreService {
  private readonly schema: string;
  private readonly documents: string;
  private readonly jobs: string;
  private readonly chunks: string;
  private readonly embeddings: string;

  constructor(private readonly dataSource: DataSource) {
    this.schema = process.env.POSTGRES_SCHEMA || "public";
    this.documents = this.tableRef("rag_documents");
    this.jobs = this.tableRef("rag_ingest_jobs");
    this.chunks = this.tableRef("rag_chunks");
    this.embeddings = this.tableRef("rag_embeddings");
  }

  // ---------------------------------------------------------------- documents

  async createDocument(input: {
    sourceType: "url" | "pdf";
    sourceUrl?: string;
    originalFilename?: string;
    fileHash?: string;
    title: string;
    createdBy?: number;
  }): Promise<RagDocumentRow> {
    const rows = rowsOf(
      await this.dataSource.query(
        `INSERT INTO ${this.documents}
           (id, source_type, source_url, original_filename, file_hash, title, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
         RETURNING *`,
        [
          randomUUID(),
          input.sourceType,
          input.sourceUrl ?? null,
          input.originalFilename ?? null,
          input.fileHash ?? null,
          input.title,
          input.createdBy ?? null,
        ]
      )
    );
    return toDocument(rows[0]);
  }

  async findDocumentBySourceUrl(url: string): Promise<RagDocumentRow | null> {
    const rows = rowsOf(await this.dataSource.query(`SELECT * FROM ${this.documents} WHERE source_url = $1 LIMIT 1`, [url]));
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async findDocumentByFileHash(hash: string): Promise<RagDocumentRow | null> {
    const rows = rowsOf(
      await this.dataSource.query(`SELECT * FROM ${this.documents} WHERE source_type = 'pdf' AND file_hash = $1 LIMIT 1`, [hash])
    );
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async getDocument(id: string): Promise<RagDocumentRow | null> {
    const rows = rowsOf(await this.dataSource.query(`SELECT * FROM ${this.documents} WHERE id = $1`, [id]));
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async listDocuments(q: {
    search?: string;
    status?: string;
    language?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: (RagDocumentRow & { latestJob: RagJobRow | null })[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.search) {
      params.push(`%${q.search}%`);
      where.push(`(d.title ILIKE $${params.length} OR d.source_url ILIKE $${params.length})`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`d.status = $${params.length}`);
    }
    if (q.language) {
      params.push(q.language);
      where.push(`d.language = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countRows = rowsOf(await this.dataSource.query(`SELECT count(*) AS count FROM ${this.documents} d ${whereSql}`, params));
    const total = Number(countRows[0]?.count ?? 0);

    const listParams = [...params, q.limit, Math.max(0, (q.page - 1) * q.limit)];
    const rows = rowsOf(
      await this.dataSource.query(
        `SELECT d.*,
                lj.id AS job_id, lj.status AS job_status, lj.stage AS job_stage, lj.progress AS job_progress,
                lj.error_message AS job_error_message, lj.warnings AS job_warnings, lj.attempt AS job_attempt,
                lj.started_at AS job_started_at, lj.finished_at AS job_finished_at, lj.created_at AS job_created_at
         FROM ${this.documents} d
         LEFT JOIN LATERAL (
           SELECT * FROM ${this.jobs} j WHERE j.document_id = d.id ORDER BY created_at DESC LIMIT 1
         ) lj ON true
         ${whereSql}
         ORDER BY d.created_at DESC, d.id
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        listParams
      )
    );

    return {
      rows: rows.map((r) => ({
        ...toDocument(r),
        latestJob:
          r.job_id === null || r.job_id === undefined
            ? null
            : toJob({
                id: r.job_id,
                document_id: r.id,
                status: r.job_status,
                stage: r.job_stage,
                progress: r.job_progress,
                error_message: r.job_error_message,
                warnings: r.job_warnings,
                attempt: r.job_attempt,
                started_at: r.job_started_at,
                finished_at: r.job_finished_at,
                created_at: r.job_created_at,
              }),
      })),
      total,
    };
  }

  async updateDocument(
    id: string,
    patch: Partial<Pick<RagDocumentRow, "title" | "filePath" | "status" | "language" | "chunkCount">>
  ): Promise<RagDocumentRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, column] of Object.entries(DOCUMENT_PATCH_COLUMNS)) {
      const value = (patch as Record<string, unknown>)[key];
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    sets.push("updated_at = now()");
    const rows = rowsOf(await this.dataSource.query(`UPDATE ${this.documents} SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params));
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async deleteDocument(id: string): Promise<boolean> {
    // Chunks are removed explicitly because the chunk FK is NOT VALID for legacy rows but still cascades for new ones.
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM ${this.chunks} WHERE doc_id = $1`, [id]);
      const rows = rowsOf(await manager.query(`DELETE FROM ${this.documents} WHERE id = $1 RETURNING id`, [id]));
      return rows.length > 0;
    });
  }

  // --------------------------------------------------------------------- jobs

  async enqueueJob(documentId: string): Promise<RagJobRow> {
    return this.dataSource.transaction(async (manager) => {
      const rows = rowsOf(
        await manager.query(
          `INSERT INTO ${this.jobs} (document_id, status, attempt)
           VALUES ($1, 'pending', (SELECT count(*)::int + 1 FROM ${this.jobs} WHERE document_id = $1))
           RETURNING *`,
          [documentId]
        )
      );
      await manager.query(`UPDATE ${this.documents} SET status = 'pending', updated_at = now() WHERE id = $1`, [documentId]);
      return toJob(rows[0]);
    });
  }

  async hasActiveJob(documentId: string): Promise<boolean> {
    const rows = rowsOf(
      await this.dataSource.query(
        `SELECT 1 FROM ${this.jobs} WHERE document_id = $1 AND status IN ('pending', 'running') LIMIT 1`,
        [documentId]
      )
    );
    return rows.length > 0;
  }

  async claimNextJob(): Promise<RagJobRow | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows = rowsOf(
        await manager.query(
          `UPDATE ${this.jobs} SET status = 'running', started_at = now()
           WHERE id = (
             SELECT id FROM ${this.jobs} WHERE status = 'pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
           )
           RETURNING *`
        )
      );
      if (rows.length === 0) return null;
      const job = toJob(rows[0]);
      await manager.query(`UPDATE ${this.documents} SET status = 'processing', updated_at = now() WHERE id = $1`, [job.documentId]);
      return job;
    });
  }

  async updateJobProgress(jobId: string, stage: string, progress: number): Promise<void> {
    await this.dataSource.query(`UPDATE ${this.jobs} SET stage = $2, progress = $3 WHERE id = $1`, [jobId, stage, progress]);
  }

  async finishJob(jobId: string, warnings: string[]): Promise<void> {
    await this.dataSource.query(
      `UPDATE ${this.jobs} SET status = 'done', progress = 100, warnings = $2::jsonb, finished_at = now() WHERE id = $1`,
      [jobId, JSON.stringify(warnings)]
    );
  }

  async failJob(jobId: string, message: string, warnings: string[]): Promise<void> {
    await this.dataSource.query(
      `UPDATE ${this.jobs} SET status = 'failed', error_message = $2, warnings = $3::jsonb, finished_at = now() WHERE id = $1`,
      [jobId, message, JSON.stringify(warnings)]
    );
    // 0 rows is fine when the document was deleted meanwhile.
    await this.dataSource.query(
      `UPDATE ${this.documents} SET status = 'failed', updated_at = now()
       WHERE id = (SELECT document_id FROM ${this.jobs} WHERE id = $1)`,
      [jobId]
    );
  }

  async resetRunningJobs(): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows = rowsOf(
        await manager.query(`UPDATE ${this.jobs} SET status = 'pending', started_at = NULL WHERE status = 'running' RETURNING document_id`)
      );
      await manager.query(`UPDATE ${this.documents} SET status = 'pending', updated_at = now() WHERE status = 'processing'`);
      return rows.length;
    });
  }

  // ------------------------------------------------------------------- chunks

  async getExistingChunkStates(documentId: string): Promise<ExistingChunkState[]> {
    const rows = rowsOf(
      await this.dataSource.query(
        `SELECT id, chunk_key, source_content_hash, is_manually_edited FROM ${this.chunks} WHERE doc_id = $1 AND chunk_key IS NOT NULL`,
        [documentId]
      )
    );
    return rows.map(toExistingState);
  }

  async listChunks(documentId: string, f: { blockKind?: string; needsReview?: boolean; isActive?: boolean }): Promise<RagChunkRow[]> {
    const where = ["doc_id = $1"];
    const params: unknown[] = [documentId];
    if (f.blockKind !== undefined) {
      params.push(f.blockKind);
      where.push(`block_kind = $${params.length}`);
    }
    if (f.needsReview !== undefined) {
      params.push(f.needsReview);
      where.push(`needs_review = $${params.length}`);
    }
    if (f.isActive !== undefined) {
      params.push(f.isActive);
      where.push(`is_active = $${params.length}`);
    }
    const rows = rowsOf(
      await this.dataSource.query(`SELECT * FROM ${this.chunks} WHERE ${where.join(" AND ")} ORDER BY chunk_key, id`, params)
    );
    return rows.map(toChunk);
  }

  async getChunk(id: string): Promise<RagChunkRow | null> {
    const rows = rowsOf(await this.dataSource.query(`SELECT * FROM ${this.chunks} WHERE id = $1`, [id]));
    return rows[0] ? toChunk(rows[0]) : null;
  }

  async updateChunk(
    id: string,
    patch: {
      content?: string;
      domain?: RagDomain;
      tags?: RagTags;
      isActive?: boolean;
      isManuallyEdited?: boolean;
      needsReview?: boolean;
      tagScores?: Record<string, number>;
      tagger?: string;
    }
  ): Promise<RagChunkRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    let metadataExpr = "metadata";

    if (patch.content !== undefined) {
      sets.push(`content = ${push(patch.content)}`);
      sets.push(`content_hash = ${push(sha256(patch.content))}`);
    }
    if (patch.domain !== undefined) {
      const p = push(patch.domain);
      sets.push(`domain = ${p}`);
      metadataExpr = `jsonb_set(${metadataExpr}, '{domain}', to_jsonb(${p}::text))`;
    }
    if (patch.tags !== undefined) {
      const p = push(JSON.stringify(patch.tags));
      sets.push(`tags = ${p}::jsonb`);
      metadataExpr = `jsonb_set(${metadataExpr}, '{tags}', ${p}::jsonb)`;
    }
    if (patch.tagger !== undefined) {
      metadataExpr = `jsonb_set(${metadataExpr}, '{tagger}', to_jsonb(${push(patch.tagger)}::text))`;
    }
    if (patch.tagScores !== undefined) sets.push(`tag_scores = ${push(JSON.stringify(patch.tagScores))}::jsonb`);
    if (patch.isActive !== undefined) sets.push(`is_active = ${push(patch.isActive)}`);
    if (patch.isManuallyEdited !== undefined) sets.push(`is_manually_edited = ${push(patch.isManuallyEdited)}`);
    if (patch.needsReview !== undefined) sets.push(`needs_review = ${push(patch.needsReview)}`);
    if (metadataExpr !== "metadata") sets.push(`metadata = ${metadataExpr}`);
    sets.push("updated_at = now()");

    const rows = rowsOf(await this.dataSource.query(`UPDATE ${this.chunks} SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params));
    return rows[0] ? toChunk(rows[0]) : null;
  }

  async upsertEmbedding(chunkId: string, embedding: number[], contentHash: string, model: string): Promise<void> {
    await this.writeEmbedding((sql, params) => this.dataSource.query(sql, params), chunkId, embedding, contentHash, model);
  }

  // ------------------------------------------------------------ ingest result

  async applyIngestResult(
    documentId: string,
    input: ApplyIngestInput
  ): Promise<{ documentMissing: boolean; plan?: ChunkMergePlan }> {
    const model = process.env.RAG_EMBEDDING_MODEL || "bge-m3";

    return this.dataSource.transaction(async (manager) => {
      const q: QueryFn = (sql, params) => manager.query(sql, params);

      // 1. Lock the document row. If it was deleted while the job ran, write nothing.
      const docRows = rowsOf(
        await q(
          `SELECT id, source_type, source_url, original_filename, title FROM ${this.documents} WHERE id = $1 FOR UPDATE`,
          [documentId]
        )
      );
      if (docRows.length === 0) return { documentMissing: true };
      const doc = docRows[0];

      // 2. Lock the chunk rows and read their state inside the transaction. A concurrent admin edit
      //    waits for this commit and then lands afterwards, so it wins. The plan MUST use these rows.
      const existingRows = rowsOf(
        await q(
          `SELECT id, chunk_key, source_content_hash, is_manually_edited FROM ${this.chunks}
           WHERE doc_id = $1 AND chunk_key IS NOT NULL FOR UPDATE`,
          [documentId]
        )
      );
      const existing = existingRows.map(toExistingState);
      const plan = planChunkMerge(existing, input.draftKeys);

      const readyByKey = new Map(input.chunks.map((chunk) => [chunk.chunkKey, chunk]));
      const needed = [...plan.insertKeys, ...plan.replaceKeys];
      for (const key of needed) {
        if (!readyByKey.has(key)) throw new Error(`applyIngestResult: no ReadyChunk supplied for chunk key "${key}"`);
      }

      const placeholder: string | null =
        doc.source_type === "pdf" ? (doc.original_filename ? String(doc.original_filename).replace(/\.pdf$/i, "") : null) : (doc.source_url ?? null);
      const titleIsPlaceholder = doc.title === "" || (placeholder !== null && doc.title === placeholder);
      const effectiveTitle: string = titleIsPlaceholder ? input.title : doc.title;
      const source: string = doc.source_url ?? doc.original_filename ?? "";

      for (const key of plan.insertKeys) {
        const chunk = readyByKey.get(key)!;
        await q(
          `INSERT INTO ${this.chunks}
             (id, doc_id, source, title, content, metadata, content_hash, chunk_key, heading_path, page_from, page_to,
              block_kind, image_path, language, domain, tags, tag_scores, source_content_hash,
              is_active, is_manually_edited, needs_review)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18,
                   true, false, false)`,
          [
            `${documentId}-${chunk.chunkKey}`,
            documentId,
            source,
            effectiveTitle,
            chunk.content,
            JSON.stringify(this.chunkMetadata(chunk)),
            sha256(chunk.content),
            chunk.chunkKey,
            chunk.headingPath,
            chunk.pageFrom,
            chunk.pageTo,
            chunk.blockKind,
            chunk.imagePath,
            chunk.language,
            chunk.domain,
            JSON.stringify(chunk.tags),
            JSON.stringify(chunk.tagScores),
            chunk.sourceContentHash,
          ]
        );
        await this.writeEmbedding(q, `${documentId}-${chunk.chunkKey}`, chunk.embedding, chunk.embeddingHash, model);
      }

      // replaceKeys never touch is_active, is_manually_edited or needs_review.
      const idByKey = new Map(existing.map((chunk) => [chunk.chunkKey, chunk.id]));
      for (const key of plan.replaceKeys) {
        const chunk = readyByKey.get(key)!;
        const chunkId = idByKey.get(key)!;
        await q(
          `UPDATE ${this.chunks}
           SET content = $2, title = $3, heading_path = $4, page_from = $5, page_to = $6, block_kind = $7,
               language = $8, domain = $9, tags = $10::jsonb, tag_scores = $11::jsonb, metadata = $12::jsonb,
               image_path = $13, content_hash = $14, source_content_hash = $15, updated_at = now()
           WHERE id = $1`,
          [
            chunkId,
            chunk.content,
            effectiveTitle,
            chunk.headingPath,
            chunk.pageFrom,
            chunk.pageTo,
            chunk.blockKind,
            chunk.language,
            chunk.domain,
            JSON.stringify(chunk.tags),
            JSON.stringify(chunk.tagScores),
            JSON.stringify(this.chunkMetadata(chunk)),
            chunk.imagePath,
            sha256(chunk.content),
            chunk.sourceContentHash,
          ]
        );
        await this.writeEmbedding(q, chunkId, chunk.embedding, chunk.embeddingHash, model);
      }

      // Manually edited chunks whose source changed: keep content, tags and embedding.
      const hashByKey = new Map(input.draftKeys.map((draft) => [draft.chunkKey, draft.sourceContentHash]));
      for (const key of plan.flagReviewKeys) {
        await q(
          `UPDATE ${this.chunks} SET needs_review = true, source_content_hash = $2, updated_at = now() WHERE id = $1`,
          [idByKey.get(key), hashByKey.get(key)]
        );
      }

      if (plan.flagReviewMissingIds.length > 0) {
        await q(`UPDATE ${this.chunks} SET needs_review = true, updated_at = now() WHERE id = ANY($1::text[])`, [plan.flagReviewMissingIds]);
      }

      if (plan.deleteIds.length > 0) {
        // rag_embeddings rows cascade.
        await q(`DELETE FROM ${this.chunks} WHERE id = ANY($1::text[])`, [plan.deleteIds]);
      }

      const countRows = rowsOf(await q(`SELECT count(*)::int AS count FROM ${this.chunks} WHERE doc_id = $1`, [documentId]));
      const chunkCount = Number(countRows[0]?.count ?? 0);

      await q(
        `UPDATE ${this.documents}
         SET title = CASE WHEN title = '' OR title = $2 THEN $3 ELSE title END,
             language = $4, chunk_count = $5, status = 'ready', updated_at = now()
         WHERE id = $1`,
        [documentId, placeholder, input.title, input.language, chunkCount]
      );

      return { documentMissing: false, plan };
    });
  }

  // ------------------------------------------------------------------ helpers

  private chunkMetadata(chunk: ReadyChunk): Record<string, unknown> {
    const metadata: Record<string, unknown> = { domain: chunk.domain, tags: chunk.tags, tagger: chunk.tagger };
    if (chunk.tagFailed) metadata.tagError = true;
    return metadata;
  }

  private async writeEmbedding(q: QueryFn, chunkId: string, embedding: number[], contentHash: string, model: string): Promise<void> {
    await q(
      `INSERT INTO ${this.embeddings} (id, embedding, content_hash, model)
       VALUES ($1, $2::vector, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash, model = EXCLUDED.model, updated_at = now()`,
      [chunkId, `[${embedding.join(",")}]`, contentHash, model]
    );
  }

  private quoteIdent(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid SQL identifier: ${name}`);
    }
    return `"${name}"`;
  }

  private tableRef(tableName: string): string {
    return `${this.quoteIdent(this.schema)}.${this.quoteIdent(tableName)}`;
  }
}
