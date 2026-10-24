import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import { RetrievalService } from "../retrieval/retrieval.service";
import { VectorService } from "../retrieval/vector.service";
import { buildEmbeddingText, chunkDocument } from "./chunker";
import { planChunkMerge } from "./chunk-merge-planner";
import { DoclingClient, DoclingError } from "./docling.client";
import { ImageTranscriberService } from "./image-transcriber.service";
import { RagFileStorageService } from "./rag-file-storage.service";
import { DraftChunk, ExtractedDocument } from "./rag-ingest.types";
import { RagJobRow, RagStoreService, ReadyChunk } from "./rag-store.service";
import { emptyTags } from "./rag-taxonomy";
import { TaggingService } from "./taggers/tagging.service";
import { countWords, documentLanguage } from "./text-normalize";

const MIN_TEXT_WORDS = 50;
const DEFAULT_MAX_PDF_PAGES = 300;
const MAX_MESSAGE_CHARS = 200;
/** Keeps the duplicate failure message within MAX_MESSAGE_CHARS. */
const MAX_DUPLICATE_TITLE_CHARS = 120;

/** An error whose message is already safe and readable for the admin UI. */
class PipelineError extends Error {}

function shortMessage(err: unknown): string {
  const raw = typeof (err as { message?: unknown } | null)?.message === "string" ? (err as Error).message : "unknown error";
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_CHARS);
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Maps done/total onto [from, to] as an integer. */
function scale(from: number, to: number, done: number, total: number): number {
  if (total <= 0) return from;
  return Math.round(from + ((to - from) * Math.min(done, total)) / total);
}

@Injectable()
export class RagIngestPipeline {
  private readonly logger = new Logger(RagIngestPipeline.name);

  constructor(
    private readonly docling: DoclingClient,
    private readonly transcriber: ImageTranscriberService,
    private readonly tagging: TaggingService,
    private readonly vector: VectorService,
    private readonly files: RagFileStorageService,
    private readonly store: RagStoreService,
    private readonly retrieval: RetrievalService,
    private readonly config: ConfigService
  ) {}

  /** Runs one ingest job end to end. Never throws: every failure becomes failJob with a readable message. */
  async run(job: RagJobRow): Promise<void> {
    const warnings: string[] = [];
    try {
      await this.execute(job, warnings);
    } catch (err) {
      try {
        if (!(await this.store.getDocument(job.documentId))) {
          // The document was deleted while the job ran (its job row cascaded away); nothing to report.
          await this.files.deleteDocumentDir(job.documentId);
          this.logger.debug(`Ingest job ${job.id}: document ${job.documentId} was deleted; skipping failJob`);
          return;
        }
      } catch (checkErr) {
        this.logger.warn(`Could not check document ${job.documentId} after failure: ${shortMessage(checkErr)}`);
      }
      const message = this.describeFailure(err);
      this.logger.error(`Ingest job ${job.id} failed: ${message}`);
      try {
        await this.store.failJob(job.id, message, warnings);
      } catch (failErr) {
        this.logger.error(`Could not mark ingest job ${job.id} as failed: ${shortMessage(failErr)}`);
      }
    }
  }

  private describeFailure(err: unknown): string {
    if (err instanceof PipelineError) return err.message;
    return `Unexpected error: ${shortMessage(err)}`;
  }

  private async execute(job: RagJobRow, warnings: string[]): Promise<void> {
    let lastReport = "";
    const report = async (stage: string, progress: number) => {
      const key = `${stage}:${progress}`;
      if (key === lastReport) return;
      lastReport = key;
      try {
        await this.store.updateJobProgress(job.id, stage, progress);
      } catch (err) {
        this.logger.warn(`Could not update progress of job ${job.id}: ${shortMessage(err)}`);
      }
    };
    // onProgress callbacks are sync; chain the writes so they stay ordered and never reject.
    let pending: Promise<void> = Promise.resolve();
    const reportLater = (stage: string, progress: number) => {
      pending = pending.then(() => report(stage, progress));
    };

    // ---- extracting
    await report("extracting", 5);
    const record = await this.store.getDocument(job.documentId);
    if (!record) {
      await this.files.deleteDocumentDir(job.documentId);
      return;
    }
    const isPdf = record.sourceType === "pdf";
    const maxPages = Number(this.config.get<string>("RAG_MAX_PDF_PAGES")) || DEFAULT_MAX_PDF_PAGES;
    const extracted = await this.extract(record, isPdf, maxPages);

    // Docling converts at most maxPages + 1 pages, so reaching max + 1 means the PDF is over the limit.
    if (isPdf && extracted.pageCount !== undefined && extracted.pageCount > maxPages) {
      throw new PipelineError(`PDF has more than ${maxPages} pages; the limit is ${maxPages}`);
    }
    const textWords = extracted.blocks.reduce(
      (sum, b) => (b.kind === "heading" || b.kind === "paragraph" ? sum + countWords(b.text) : sum),
      0
    );
    if (textWords < MIN_TEXT_WORDS) {
      throw new PipelineError(
        isPdf ? "PDF has no text layer (scanned PDFs are not supported)" : "Page has no readable content (it may need JavaScript)"
      );
    }

    // ---- images
    await report("images", 15);
    const { texts: imageTexts, skippedErrors } = await this.transcriber.transcribeAll(extracted.blocks, (done, total) =>
      reportLater("images", scale(15, 40, done, total))
    );
    await pending;
    if (skippedErrors > 0) {
      warnings.push(`${skippedErrors} images could not be read and were skipped`);
    }
    const imagePaths = new Map<number, string>();
    for (const index of imageTexts.keys()) {
      const block = extracted.blocks[index];
      if (block?.kind !== "image") continue;
      // Named by content: block indexes shift between document versions, and unchanged chunks keep old imagePaths.
      const name = `img-${sha256(block.image.base64).slice(0, 16)}`;
      imagePaths.set(index, await this.files.saveImage(job.documentId, name, block.image));
    }

    // ---- chunking
    await report("chunking", 45);
    const drafts = chunkDocument(extracted, imageTexts);
    if (drafts.length === 0) throw new PipelineError("No content to index");
    // Duplicate check by content, not URL: Docling follows redirects, so the final URL is unknown here.
    const duplicate = await this.store.findDocumentWithSameContent(
      job.documentId,
      drafts.map((d) => d.sourceContentHash)
    );
    if (duplicate) {
      const title = duplicate.title.length > MAX_DUPLICATE_TITLE_CHARS ? `${duplicate.title.slice(0, MAX_DUPLICATE_TITLE_CHARS)}…` : duplicate.title;
      throw new PipelineError(`Same content as the existing document "${title}"; delete this duplicate`);
    }
    const draftKeys = drafts.map((d) => ({ chunkKey: d.chunkKey, sourceContentHash: d.sourceContentHash }));
    const existing = await this.store.getExistingChunkStates(job.documentId);
    const plan = planChunkMerge(existing, draftKeys);
    const needed = new Set([...plan.insertKeys, ...plan.replaceKeys]);
    const toProcess = drafts.filter((d) => needed.has(d.chunkKey));

    // ---- tagging
    await report("tagging", 50);
    const tagResults: Awaited<ReturnType<TaggingService["tagAll"]>>["results"] = [];
    if (toProcess.length > 0) {
      const tagged = await this.tagging.tagAll(
        toProcess.map((c) => ({ text: c.content, documentTitle: extracted.title, headingPath: c.headingPath })),
        (done, total) => reportLater("tagging", scale(50, 80, done, total))
      );
      await pending;
      warnings.push(...tagged.warnings);
      tagResults.push(...tagged.results);
      const nulls = tagResults.filter((r) => r === null).length;
      if (nulls > toProcess.length / 2) throw new PipelineError("Tagging failed for more than half of the chunks");
    }

    // ---- embedding
    await report("embedding", 80);
    const embeddingTexts = toProcess.map((c) => buildEmbeddingText(extracted.title, c));
    let embeddings: number[][] = [];
    if (embeddingTexts.length > 0) {
      try {
        embeddings = await this.vector.embedDocuments(embeddingTexts);
      } catch (err) {
        throw new PipelineError(`Embedding service is unavailable: ${shortMessage(err)}`);
      }
      if (embeddings.length !== embeddingTexts.length) {
        throw new PipelineError("Embedding service is unavailable: wrong number of embeddings returned");
      }
    }
    await report("embedding", 95);

    const ready = toProcess.map((draft, i) =>
      this.toReadyChunk(job.documentId, draft, tagResults[i] ?? null, embeddings[i], embeddingTexts[i], imagePaths)
    );

    // ---- saving
    await report("saving", 95);
    const applied = await this.store.applyIngestResult(job.documentId, {
      title: extracted.title,
      language: documentLanguage(drafts),
      chunks: ready,
      draftKeys,
    });
    if (applied.documentMissing) {
      await this.files.deleteDocumentDir(job.documentId);
      return;
    }
    await this.store.finishJob(job.id, warnings);
    try {
      this.retrieval.scheduleRebuild();
    } catch (err) {
      this.logger.warn(`Could not schedule retrieval rebuild: ${shortMessage(err)}`);
    }
  }

  private async extract(
    record: { sourceUrl: string | null; filePath: string | null; originalFilename: string | null },
    isPdf: boolean,
    maxPages: number
  ): Promise<ExtractedDocument> {
    try {
      if (isPdf) {
        if (!record.filePath) throw new PipelineError("Unexpected error: the PDF file is missing");
        const buffer = await this.files.readFile(record.filePath);
        return await this.docling.convertPdf(buffer, record.originalFilename || "document.pdf", { maxPages });
      }
      if (!record.sourceUrl) throw new PipelineError("Unexpected error: the document has no source URL");
      return await this.docling.convertUrl(record.sourceUrl);
    } catch (err) {
      if (err instanceof DoclingError) {
        if (err.code === "UNAVAILABLE") throw new PipelineError("Document converter is unavailable");
        if (err.code === "FETCH_FAILED") throw new PipelineError("Could not download the page (blocked or not found)");
        if (/timed out/i.test(err.message)) throw new PipelineError(shortMessage(err));
        throw new PipelineError(`Document conversion failed: ${shortMessage(err)}`);
      }
      throw err;
    }
  }

  private toReadyChunk(
    documentId: string,
    draft: DraftChunk,
    tag: Awaited<ReturnType<TaggingService["tagAll"]>>["results"][number],
    embedding: number[],
    embeddingText: string,
    imagePaths: Map<number, string>
  ): ReadyChunk {
    const imagePath = draft.imageBlockIndex !== undefined ? (imagePaths.get(draft.imageBlockIndex) ?? null) : null;
    return {
      ...draft,
      id: `${documentId}-${draft.chunkKey}`,
      domain: tag ? tag.domain : "guidelines",
      tags: tag ? tag.tags : emptyTags(),
      tagScores: tag ? tag.scores : {},
      tagger: tag ? tag.tagger : null,
      tagFailed: tag === null,
      imagePath,
      embedding,
      embeddingHash: sha256(embeddingText),
    };
  }
}
