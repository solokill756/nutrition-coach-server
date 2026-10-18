import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import * as path from "path";
import { buildEmbeddingText } from "../../rag-ingest/chunker";
import { RagFileStorageService } from "../../rag-ingest/rag-file-storage.service";
import { RagChunkRow, RagDocumentRow, RagJobRow, RagStoreService } from "../../rag-ingest/rag-store.service";
import { RAG_DOMAINS, RAG_TAXONOMY, RagDomain, RagTags, isRagDomain, sanitizeTags } from "../../rag-ingest/rag-taxonomy";
import { TaggingService } from "../../rag-ingest/taggers/tagging.service";
import { normalizeMultiline, normalizeText } from "../../rag-ingest/text-normalize";
import { normalizeSourceUrl } from "../../rag-ingest/url-normalize";
import { RetrievalService } from "../../retrieval/retrieval.service";
import { VectorService } from "../../retrieval/vector.service";
import { AdminRagException } from "./admin-rag-documents.exception";
import { RagChunkListQueryDto } from "./dto/rag-chunk-list-query.dto";
import { RagDocumentListQueryDto } from "./dto/rag-document-list-query.dto";
import {
  RagChunkDto,
  RagChunkEnvelope,
  RagChunkListEnvelope,
  RagDocumentCreateEnvelope,
  RagDocumentDto,
  RagDocumentEnvelope,
  RagDocumentListEnvelope,
  RagJobDto,
  RagTaxonomyDto,
} from "./dto/rag-responses";
import { UpdateRagChunkRequestDto } from "./dto/update-rag-chunk-request.dto";

export type UploadedPdf = { originalname: string; mimetype: string; buffer: Buffer };

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Short, secret-free description of a failure. Never serialize the error object (axios errors hold API keys). */
function describeError(err: unknown): string {
  const e = err as { status?: unknown; response?: { status?: unknown }; message?: unknown } | null;
  const raw = e?.status ?? e?.response?.status;
  if (typeof raw === "number") return `HTTP ${raw}`;
  return typeof e?.message === "string" ? e.message.replace(/\s+/g, " ").slice(0, 120) : "unknown error";
}

function toJobDto(job: RagJobRow): RagJobDto {
  return {
    id: String(job.id),
    status: job.status as RagJobDto["status"],
    stage: job.stage,
    progress: job.progress,
    errorMessage: job.errorMessage,
    warnings: job.warnings,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}

function toDocumentDto(doc: RagDocumentRow, latestJob: RagJobRow | null): RagDocumentDto {
  return {
    id: doc.id,
    sourceType: doc.sourceType,
    sourceUrl: doc.sourceUrl,
    originalFilename: doc.originalFilename,
    title: doc.title,
    language: doc.language as RagDocumentDto["language"],
    status: doc.status as RagDocumentDto["status"],
    chunkCount: doc.chunkCount,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    latestJob: latestJob ? toJobDto(latestJob) : null,
  };
}

function toChunkDto(chunk: RagChunkRow): RagChunkDto {
  const meta = chunk.metadata ?? {};
  return {
    id: chunk.id,
    documentId: chunk.docId,
    headingPath: chunk.headingPath ?? "",
    pageFrom: chunk.pageFrom,
    pageTo: chunk.pageTo,
    blockKind: (chunk.blockKind ?? "text") as RagChunkDto["blockKind"],
    language: chunk.language as RagChunkDto["language"],
    domain: chunk.domain as RagDomain,
    tags: chunk.tags as unknown as RagTags,
    tagScores: chunk.tagScores,
    tagger: typeof meta.tagger === "string" ? meta.tagger : null,
    tagFailed: meta.tagError === true,
    content: chunk.content,
    hasImage: !!chunk.imagePath,
    isActive: chunk.isActive,
    isManuallyEdited: chunk.isManuallyEdited,
    needsReview: chunk.needsReview,
    updatedAt: chunk.updatedAt.toISOString(),
  };
}

@Injectable()
export class AdminRagDocumentsService {
  private readonly logger = new Logger(AdminRagDocumentsService.name);

  constructor(
    private readonly store: RagStoreService,
    private readonly storage: RagFileStorageService,
    private readonly tagging: TaggingService,
    private readonly vector: VectorService,
    private readonly retrieval: RetrievalService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------- documents

  async addUrl(rawUrl: string, createdBy: number): Promise<RagDocumentCreateEnvelope> {
    const url = normalizeSourceUrl(rawUrl);
    if (!url) throw new AdminRagException("RAG_INVALID_URL", HttpStatus.BAD_REQUEST);

    const existing = await this.store.findDocumentBySourceUrl(url);
    if (existing) return { success: true, data: await this.documentDto(existing), created: false };

    const created = await this.store.createDocument({ sourceType: "url", sourceUrl: url, title: url, createdBy });
    const job = await this.store.enqueueJob(created.id);
    return { success: true, data: toDocumentDto({ ...created, status: "pending" }, job), created: true };
  }

  async uploadPdf(file: UploadedPdf | undefined, createdBy: number): Promise<RagDocumentCreateEnvelope> {
    if (!file || file.mimetype !== "application/pdf" || !file.buffer || file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new AdminRagException("RAG_INVALID_FILE", HttpStatus.BAD_REQUEST);
    }

    const fileHash = sha256(file.buffer);
    const existing = await this.store.findDocumentByFileHash(fileHash);
    if (existing) return { success: true, data: await this.documentDto(existing), created: false };

    // Filename is already UTF-8 decoded by multer (defParamCharset in the controller); store it NFC.
    const originalFilename = normalizeText(path.basename(file.originalname.replace(/\\/g, "/")));
    const created = await this.store.createDocument({
      sourceType: "pdf",
      originalFilename,
      fileHash,
      title: originalFilename.replace(/\.pdf$/i, ""),
      createdBy,
    });

    try {
      const filePath = await this.storage.saveSourcePdf(created.id, file.buffer);
      await this.store.updateDocument(created.id, { filePath });
    } catch (err) {
      this.logger.error(`failed to store uploaded PDF for document ${created.id}: ${describeError(err)}`);
      await this.store.deleteDocument(created.id).catch(() => undefined);
      await this.storage.deleteDocumentDir(created.id).catch(() => undefined);
      throw err;
    }

    const job = await this.store.enqueueJob(created.id);
    return { success: true, data: toDocumentDto({ ...created, status: "pending" }, job), created: true };
  }

  async listDocuments(query: Partial<RagDocumentListQueryDto>): Promise<RagDocumentListEnvelope> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { rows, total } = await this.store.listDocuments({
      search: query.search,
      status: query.status,
      language: query.language,
      page,
      limit,
    });
    return {
      success: true,
      data: rows.map((row) => toDocumentDto(row, row.latestJob)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getDocument(id: string): Promise<RagDocumentEnvelope> {
    return { success: true, data: await this.documentDto(await this.requireDocument(id)) };
  }

  async renameDocument(id: string, title: string): Promise<RagDocumentEnvelope> {
    const trimmed = normalizeText(title);
    if (!trimmed) throw new AdminRagException("VALIDATION_ERROR", HttpStatus.BAD_REQUEST);
    const updated = await this.store.updateDocument(id, { title: trimmed });
    if (!updated) throw new AdminRagException("RAG_DOCUMENT_NOT_FOUND", HttpStatus.NOT_FOUND);
    return { success: true, data: await this.documentDto(updated) };
  }

  async reingest(id: string): Promise<RagDocumentEnvelope> {
    const doc = await this.requireDocument(id);
    if (await this.store.hasActiveJob(id)) throw new AdminRagException("RAG_JOB_IN_PROGRESS", HttpStatus.CONFLICT);
    const job = await this.store.enqueueJob(id);
    return { success: true, data: toDocumentDto({ ...doc, status: "pending" }, job) };
  }

  async deleteDocument(id: string): Promise<{ success: true; message: string }> {
    await this.requireDocument(id);
    await this.store.deleteDocument(id);
    await this.storage.deleteDocumentDir(id);
    this.retrieval.scheduleRebuild();
    return { success: true, message: "Document deleted" };
  }

  // ------------------------------------------------------------------- chunks

  async listChunks(documentId: string, query: Partial<RagChunkListQueryDto>): Promise<RagChunkListEnvelope> {
    await this.requireDocument(documentId);
    const rows = await this.store.listChunks(documentId, {
      blockKind: query.blockKind,
      needsReview: query.needsReview,
      isActive: query.isActive,
    });
    return { success: true, data: rows.map(toChunkDto) };
  }

  async updateChunk(id: string, body: Partial<UpdateRagChunkRequestDto>): Promise<RagChunkEnvelope> {
    const patch: Parameters<RagStoreService["updateChunk"]>[1] = {};

    if (body.domain !== undefined) {
      if (!isRagDomain(body.domain)) {
        throw new AdminRagException(
          "RAG_INVALID_DOMAIN",
          HttpStatus.BAD_REQUEST,
          `Invalid domain; allowed: ${RAG_DOMAINS.map((d) => d.key).join(", ")}`,
        );
      }
      patch.domain = body.domain;
    }
    if (body.tags !== undefined) {
      const { tags, invalid } = sanitizeTags(body.tags);
      if (invalid.length > 0) {
        throw new AdminRagException("RAG_INVALID_TAG", HttpStatus.BAD_REQUEST, `Invalid tags: ${invalid.join(", ")}`);
      }
      patch.tags = tags;
    }
    let content: string | undefined;
    if (body.content !== undefined) {
      content = normalizeMultiline(body.content);
      if (!content) throw new AdminRagException("VALIDATION_ERROR", HttpStatus.BAD_REQUEST, "Content must not be empty");
      patch.content = content;
    }
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (patch.content !== undefined || patch.domain !== undefined || patch.tags !== undefined) patch.isManuallyEdited = true;

    // One atomic UPDATE: content and is_manually_edited land together. null = row missing (or deleted concurrently).
    const updated = await this.store.updateChunk(id, patch);
    if (!updated) throw new AdminRagException("RAG_CHUNK_NOT_FOUND", HttpStatus.NOT_FOUND);

    // Re-enabling a chunk whose embedding is missing (e.g. removed by the old boot sync) must also
    // make it findable by vector search again.
    const embedContent =
      content ?? (body.isActive === true && !(await this.store.hasEmbedding(updated.id)) ? updated.content : undefined);
    if (embedContent !== undefined) {
      try {
        await this.reembed(updated, embedContent);
      } catch (err) {
        this.logger.warn(`re-embedding chunk ${id} failed: ${describeError(err)}`);
        this.retrieval.scheduleRebuild();
        throw new AdminRagException("RAG_EMBEDDING_FAILED", HttpStatus.BAD_GATEWAY);
      }
    }

    this.retrieval.scheduleRebuild();
    return { success: true, data: toChunkDto(updated) };
  }

  async retag(id: string): Promise<RagChunkEnvelope> {
    const current = await this.store.getChunk(id);
    if (!current) throw new AdminRagException("RAG_CHUNK_NOT_FOUND", HttpStatus.NOT_FOUND);

    let result: Awaited<ReturnType<TaggingService["tagOne"]>>;
    try {
      result = await this.tagging.tagOne(current.content);
    } catch (err) {
      this.logger.warn(`retag of chunk ${id} failed: ${describeError(err)}`);
      throw new AdminRagException("RAG_TAGGING_FAILED", HttpStatus.BAD_GATEWAY);
    }

    // Deliberately no isManuallyEdited here: a re-tag must not change the edit flag.
    const updated = await this.store.updateChunk(id, {
      domain: result.domain,
      tags: result.tags,
      tagScores: result.scores,
      tagger: result.tagger,
      clearTagError: true,
    });
    if (!updated) throw new AdminRagException("RAG_CHUNK_NOT_FOUND", HttpStatus.NOT_FOUND);
    this.retrieval.scheduleRebuild();
    return { success: true, data: toChunkDto(updated) };
  }

  async resolveReview(id: string): Promise<RagChunkEnvelope> {
    const updated = await this.store.updateChunk(id, { needsReview: false });
    if (!updated) throw new AdminRagException("RAG_CHUNK_NOT_FOUND", HttpStatus.NOT_FOUND);
    this.retrieval.scheduleRebuild();
    return { success: true, data: toChunkDto(updated) };
  }

  async getChunkImage(id: string): Promise<{ buffer: Buffer; contentType: string }> {
    const chunk = await this.store.getChunk(id);
    if (!chunk) throw new AdminRagException("RAG_CHUNK_NOT_FOUND", HttpStatus.NOT_FOUND);
    if (!chunk.imagePath) throw new AdminRagException("RAG_IMAGE_NOT_FOUND", HttpStatus.NOT_FOUND);

    let buffer: Buffer;
    try {
      buffer = await this.storage.readFile(chunk.imagePath);
    } catch {
      throw new AdminRagException("RAG_IMAGE_NOT_FOUND", HttpStatus.NOT_FOUND);
    }
    const contentType = IMAGE_CONTENT_TYPES[path.extname(chunk.imagePath).toLowerCase()] ?? "application/octet-stream";
    return { buffer, contentType };
  }

  getTaxonomy(): { success: true; data: RagTaxonomyDto } {
    return { success: true, data: { domains: RAG_DOMAINS, groups: RAG_TAXONOMY } };
  }

  // ------------------------------------------------------------------ helpers

  private async requireDocument(id: string): Promise<RagDocumentRow> {
    const doc = await this.store.getDocument(id);
    if (!doc) throw new AdminRagException("RAG_DOCUMENT_NOT_FOUND", HttpStatus.NOT_FOUND);
    return doc;
  }

  private async documentDto(doc: RagDocumentRow): Promise<RagDocumentDto> {
    return toDocumentDto(doc, await this.store.getLatestJob(doc.id));
  }

  private async reembed(chunk: RagChunkRow, content: string): Promise<void> {
    const doc = await this.store.getDocument(chunk.docId);
    const text = buildEmbeddingText(doc?.title ?? chunk.title, { headingPath: chunk.headingPath ?? "", content });
    const [vec] = await this.vector.embedDocuments([text]);
    await this.store.upsertEmbedding(chunk.id, vec, sha256(text), this.embeddingModel());
  }

  private embeddingModel(): string {
    return this.config.get<string>("RAG_EMBEDDING_MODEL") || this.config.get<string>("POSTGRES_EMBEDDING_MODEL") || "bge-m3";
  }
}
