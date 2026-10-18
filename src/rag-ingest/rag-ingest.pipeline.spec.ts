import { Logger } from "@nestjs/common";
import { DoclingError } from "./docling.client";
import { RagIngestPipeline } from "./rag-ingest.pipeline";
import { ExtractedDocument, DraftChunk } from "./rag-ingest.types";
import { RagJobRow } from "./rag-store.service";

jest.mock("./chunker", () => ({
  chunkDocument: jest.fn(),
  buildEmbeddingText: (title: string, c: { headingPath: string; content: string }) => `${title}|${c.headingPath}|${c.content}`,
}));
import { chunkDocument } from "./chunker";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

function doc(over: Partial<ExtractedDocument> = {}): ExtractedDocument {
  return {
    title: "Extracted Title",
    pageCount: 3,
    blocks: [
      { kind: "heading", level: 1, text: "Intro" },
      { kind: "paragraph", text: words(80) },
    ],
    ...over,
  };
}

function drafts(n: number, extra: Partial<DraftChunk>[] = []): DraftChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    chunkKey: `k${i}`,
    headingPath: "Intro",
    pageFrom: 1,
    pageTo: 1,
    blockKind: "text" as const,
    content: `content ${i}`,
    language: "en" as const,
    sourceContentHash: `h${i}`,
    ...(extra[i] ?? {}),
  }));
}

const job: RagJobRow = {
  id: "7",
  documentId: "doc-1",
  status: "running",
  stage: null,
  progress: 0,
  errorMessage: null,
  warnings: [],
  attempt: 1,
  startedAt: null,
  finishedAt: null,
  createdAt: new Date(),
};

function setup(opts: { sourceType?: "pdf" | "url"; extracted?: ExtractedDocument; chunks?: DraftChunk[]; existing?: any[] } = {}) {
  const extracted = opts.extracted ?? doc();
  (chunkDocument as jest.Mock).mockReturnValue(opts.chunks ?? drafts(3));
  const docling: any = {
    convertPdf: jest.fn().mockResolvedValue(extracted),
    convertUrl: jest.fn().mockResolvedValue(extracted),
  };
  const transcriber: any = {
    transcribeAll: jest.fn(async (_b: any, onProgress: any) => {
      onProgress?.(1, 2);
      onProgress?.(2, 2);
      return { texts: new Map(), skippedErrors: 0 };
    }),
  };
  const tagging: any = {
    tagAll: jest.fn(async (texts: string[], onProgress: any) => {
      texts.forEach((_t, i) => onProgress?.(i + 1, texts.length));
      return {
        results: texts.map(() => ({ domain: "guidelines", tags: { conditions: [], allergens: [], goals: [], nutrients: [] }, scores: {}, tagger: "jev" })),
        warnings: [],
      };
    }),
  };
  const vector: any = { embedDocuments: jest.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])) };
  const files: any = {
    readFile: jest.fn().mockResolvedValue(Buffer.from("pdf")),
    saveImage: jest.fn(async (_d: string, name: string) => `documents/doc-1/images/${name}.png`),
    deleteDocumentDir: jest.fn().mockResolvedValue(undefined),
  };
  const store: any = {
    getDocument: jest.fn().mockResolvedValue({
      id: "doc-1",
      sourceType: opts.sourceType ?? "pdf",
      sourceUrl: "https://x.test/p",
      originalFilename: "a.pdf",
      filePath: "documents/doc-1/source.pdf",
    }),
    getExistingChunkStates: jest.fn().mockResolvedValue(opts.existing ?? []),
    updateJobProgress: jest.fn().mockResolvedValue(undefined),
    applyIngestResult: jest.fn().mockResolvedValue({ documentMissing: false }),
    finishJob: jest.fn().mockResolvedValue(undefined),
    failJob: jest.fn().mockResolvedValue(undefined),
  };
  const retrieval: any = { scheduleRebuild: jest.fn() };
  const config: any = { get: (k: string) => ({ RAG_MAX_PDF_PAGES: "300" } as Record<string, string>)[k] };
  const pipeline = new RagIngestPipeline(docling, transcriber, tagging, vector, files, store, retrieval, config);
  return { pipeline, docling, transcriber, tagging, vector, files, store, retrieval };
}

describe("RagIngestPipeline", () => {
  beforeEach(() => {
    for (const m of ["log", "error", "warn", "debug"] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it("names images by content so a shifted block index never reuses another image's name", async () => {
    const imgA = { base64: "AAAA", mimeType: "image/png", width: 300, height: 300 };
    const imgB = { base64: "BBBB", mimeType: "image/png", width: 300, height: 300 };
    const text = { kind: "paragraph" as const, text: words(80) };
    const run = async (blocks: any[], texts: [number, string][]) => {
      const s = setup({ extracted: doc({ blocks }) });
      s.transcriber.transcribeAll.mockResolvedValue({ texts: new Map(texts), skippedErrors: 0 });
      await s.pipeline.run(job);
      return s.files.saveImage.mock.calls.map((c: any[]) => ({ name: c[1], base64: c[2].base64 }));
    };
    const v1 = await run([text, { kind: "image", image: imgA }], [[1, "a"]]);
    const v2 = await run([text, { kind: "image", image: imgB }, { kind: "image", image: imgA }], [[1, "b"], [2, "a"]]);
    const all = [...v1, ...v2];
    const byName = new Map<string, string>();
    for (const { name, base64 } of all) {
      expect(byName.get(name) ?? base64).toBe(base64);
      byName.set(name, base64);
    }
    expect(v1[0].name).toBe(v2[1].name);
    expect(v2[0].name).not.toBe(v2[1].name);
    expect(v1[0].name).toMatch(/^img-[0-9a-f]{16}$/);
  });

  it("cleans up and skips failJob when the document is missing at the start", async () => {
    const s = setup();
    s.store.getDocument.mockResolvedValue(null);
    await s.pipeline.run(job);
    expect(s.files.deleteDocumentDir).toHaveBeenCalledWith("doc-1");
    expect(s.store.failJob).not.toHaveBeenCalled();
    expect(s.store.finishJob).not.toHaveBeenCalled();
  });

  it("skips failJob when the document is deleted mid-run and a later stage fails", async () => {
    const s = setup();
    const rec = await s.store.getDocument();
    s.store.getDocument.mockResolvedValueOnce(rec).mockResolvedValue(null);
    s.vector.embedDocuments.mockRejectedValue(new Error("ollama down"));
    await s.pipeline.run(job);
    expect(s.files.deleteDocumentDir).toHaveBeenCalledWith("doc-1");
    expect(s.store.failJob).not.toHaveBeenCalled();
    expect(s.store.finishJob).not.toHaveBeenCalled();
  });

  it("(a) runs the full flow in stage order", async () => {
    const s = setup();
    await s.pipeline.run(job);
    const stages = s.store.updateJobProgress.mock.calls.map((c: any[]) => c[1]);
    const unique = stages.filter((st: string, i: number) => stages.indexOf(st) === i);
    expect(unique).toEqual(["extracting", "images", "chunking", "tagging", "embedding", "saving"]);
    expect(s.store.updateJobProgress).toHaveBeenCalledWith("7", "extracting", 5);
    expect(s.store.applyIngestResult).toHaveBeenCalledTimes(1);
    const [docId, input] = s.store.applyIngestResult.mock.calls[0];
    expect(docId).toBe("doc-1");
    expect(input.title).toBe("Extracted Title");
    expect(input.language).toBe("en");
    expect(input.draftKeys).toHaveLength(3);
    expect(input.chunks).toHaveLength(3);
    expect(input.chunks[0]).toMatchObject({ id: "doc-1-k0", tagger: "jev", tagFailed: false, imagePath: null });
    expect(input.chunks[0].embeddingHash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.store.finishJob).toHaveBeenCalledWith("7", []);
    expect(s.retrieval.scheduleRebuild).toHaveBeenCalledTimes(1);
    expect(s.store.failJob).not.toHaveBeenCalled();
    const progresses = s.store.updateJobProgress.mock.calls.map((c: any[]) => c[2]);
    expect(progresses.every((p: number) => Number.isInteger(p))).toBe(true);
  });

  it("(b) fails a PDF with no text layer", async () => {
    const s = setup({ extracted: doc({ blocks: [{ kind: "paragraph", text: words(10) }] }) });
    await s.pipeline.run(job);
    expect(s.store.failJob).toHaveBeenCalledWith("7", "PDF has no text layer (scanned PDFs are not supported)", []);
    expect(s.store.applyIngestResult).not.toHaveBeenCalled();
  });

  it("fails a URL with no readable content", async () => {
    const s = setup({ sourceType: "url", extracted: doc({ blocks: [{ kind: "paragraph", text: words(10) }] }) });
    await s.pipeline.run(job);
    expect(s.store.failJob).toHaveBeenCalledWith("7", "Page has no readable content (it may need JavaScript)", []);
  });

  it("asks Docling to convert at most RAG_MAX_PDF_PAGES + 1 pages of a PDF", async () => {
    const s = setup();
    await s.pipeline.run(job);
    expect(s.docling.convertPdf).toHaveBeenCalledWith(expect.any(Buffer), "a.pdf", { maxPages: 300 });
    expect(s.store.finishJob).toHaveBeenCalled();
  });

  it("fails when the capped conversion reaches max + 1 pages (the PDF is over the limit)", async () => {
    const s = setup({ extracted: doc({ pageCount: 301 }) });
    await s.pipeline.run(job);
    expect(s.store.failJob).toHaveBeenCalledWith("7", "PDF has more than 300 pages; the limit is 300", []);
    expect(s.transcriber.transcribeAll).not.toHaveBeenCalled();
  });

  it("accepts a PDF of exactly RAG_MAX_PDF_PAGES pages", async () => {
    const s = setup({ extracted: doc({ pageCount: 300 }) });
    await s.pipeline.run(job);
    expect(s.store.failJob).not.toHaveBeenCalled();
    expect(s.store.finishJob).toHaveBeenCalled();
  });

  it("fails with 'No content to index' when there are no chunks", async () => {
    const s = setup({ chunks: [] });
    await s.pipeline.run(job);
    expect(s.store.failJob).toHaveBeenCalledWith("7", "No content to index", []);
  });

  it("(c) fails when more than half of the tag results are null", async () => {
    const s = setup({ chunks: drafts(10) });
    s.tagging.tagAll.mockImplementation(async (texts: string[]) => ({
      results: texts.map((_t, i) => (i < 6 ? null : { domain: "guidelines", tags: { conditions: [], allergens: [], goals: [], nutrients: [] }, scores: {}, tagger: "gemini" })),
      warnings: ["tag warning"],
    }));
    await s.pipeline.run(job);
    expect(s.store.failJob).toHaveBeenCalledWith("7", "Tagging failed for more than half of the chunks", ["tag warning"]);
    expect(s.store.applyIngestResult).not.toHaveBeenCalled();
  });

  it("marks null tag results as tagFailed with the default domain", async () => {
    const s = setup({ chunks: drafts(3) });
    s.tagging.tagAll.mockImplementation(async (texts: string[]) => ({
      results: texts.map((_t, i) => (i === 0 ? null : { domain: "safety", tags: { conditions: ["x"], allergens: [], goals: [], nutrients: [] }, scores: { a: 1 }, tagger: "jev" })),
      warnings: [],
    }));
    await s.pipeline.run(job);
    const chunks = s.store.applyIngestResult.mock.calls[0][1].chunks;
    expect(chunks[0]).toMatchObject({ tagFailed: true, tagger: null, domain: "guidelines", tags: { conditions: [], allergens: [], goals: [], nutrients: [] } });
    expect(chunks[1]).toMatchObject({ tagFailed: false, tagger: "jev", domain: "safety" });
  });

  it("(d) still finishes when images were skipped, with a warning", async () => {
    const s = setup();
    s.transcriber.transcribeAll.mockResolvedValue({ texts: new Map(), skippedErrors: 2 });
    await s.pipeline.run(job);
    expect(s.store.finishJob).toHaveBeenCalledWith("7", ["2 images could not be read and were skipped"]);
  });

  it("(e) sends only insert/replace chunks to tagging and embedding", async () => {
    const s = setup({
      chunks: drafts(3),
      existing: [
        { id: "doc-1-k0", chunkKey: "k0", sourceContentHash: "h0", isManuallyEdited: false },
        { id: "doc-1-k1", chunkKey: "k1", sourceContentHash: "old", isManuallyEdited: false },
      ],
    });
    await s.pipeline.run(job);
    expect(s.tagging.tagAll.mock.calls[0][0]).toHaveLength(2);
    expect(s.vector.embedDocuments.mock.calls[0][0]).toHaveLength(2);
    const input = s.store.applyIngestResult.mock.calls[0][1];
    expect(input.chunks.map((c: any) => c.chunkKey)).toEqual(["k1", "k2"]);
    expect(input.draftKeys).toHaveLength(3);
  });

  it("skips tagging and embedding entirely when nothing changed", async () => {
    const s = setup({
      chunks: drafts(1),
      existing: [{ id: "doc-1-k0", chunkKey: "k0", sourceContentHash: "h0", isManuallyEdited: false }],
    });
    await s.pipeline.run(job);
    expect(s.tagging.tagAll).not.toHaveBeenCalled();
    expect(s.store.failJob).not.toHaveBeenCalled();
    expect(s.store.finishJob).toHaveBeenCalled();
  });

  it("saves transcribed images and links imagePath to the image chunk", async () => {
    const image = { base64: "AAAA", mimeType: "image/png", width: 300, height: 300 };
    const extracted = doc({
      blocks: [
        { kind: "paragraph", text: words(80) },
        { kind: "image", image },
      ],
    });
    const s = setup({ extracted, chunks: drafts(2, [{}, { blockKind: "image", imageBlockIndex: 1 }]) });
    s.transcriber.transcribeAll.mockResolvedValue({ texts: new Map([[1, "a chart"]]), skippedErrors: 0 });
    await s.pipeline.run(job);
    const name = s.files.saveImage.mock.calls[0][1];
    expect(name).toMatch(/^img-[0-9a-f]{16}$/);
    expect(s.files.saveImage).toHaveBeenCalledWith("doc-1", name, image);
    const chunks = s.store.applyIngestResult.mock.calls[0][1].chunks;
    expect(chunks[0].imagePath).toBeNull();
    expect(chunks[1].imagePath).toBe(`documents/doc-1/images/${name}.png`);
  });

  it("(f) cleans up and stays silent when the document was deleted", async () => {
    const s = setup();
    s.store.applyIngestResult.mockResolvedValue({ documentMissing: true });
    await s.pipeline.run(job);
    expect(s.files.deleteDocumentDir).toHaveBeenCalledWith("doc-1");
    expect(s.store.finishJob).not.toHaveBeenCalled();
    expect(s.store.failJob).not.toHaveBeenCalled();
    expect(s.retrieval.scheduleRebuild).not.toHaveBeenCalled();
  });

  it("(g) maps docling UNAVAILABLE", async () => {
    const s = setup();
    s.docling.convertPdf.mockRejectedValue(new DoclingError("UNAVAILABLE"));
    await expect(s.pipeline.run(job)).resolves.toBeUndefined();
    expect(s.store.failJob).toHaveBeenCalledWith("7", "Document converter is unavailable", []);
  });

  it("maps docling FETCH_FAILED, CONVERT_FAILED and timeout", async () => {
    const s = setup({ sourceType: "url" });
    s.docling.convertUrl.mockRejectedValueOnce(new DoclingError("FETCH_FAILED", "404"));
    await s.pipeline.run(job);
    expect(s.store.failJob).toHaveBeenLastCalledWith("7", "Could not download the page (blocked or not found)", []);
    s.docling.convertUrl.mockRejectedValueOnce(new DoclingError("CONVERT_FAILED", "bad layout"));
    await s.pipeline.run(job);
    expect(s.store.failJob).toHaveBeenLastCalledWith("7", "Document conversion failed: bad layout", []);
    s.docling.convertUrl.mockRejectedValueOnce(new DoclingError("CONVERT_FAILED", "Document conversion timed out after 60 minutes"));
    await s.pipeline.run(job);
    expect(s.store.failJob).toHaveBeenLastCalledWith("7", "Document conversion timed out after 60 minutes", []);
  });

  it("maps embedding failures and unexpected errors, and never throws", async () => {
    const s = setup();
    s.vector.embedDocuments.mockRejectedValue(new Error("ollama down"));
    await s.pipeline.run(job);
    expect(s.store.failJob).toHaveBeenLastCalledWith("7", "Embedding service is unavailable: ollama down", []);

    const s2 = setup();
    s2.store.applyIngestResult.mockRejectedValue(new Error("x".repeat(500)));
    s2.store.failJob.mockRejectedValue(new Error("db gone"));
    await expect(s2.pipeline.run(job)).resolves.toBeUndefined();
    const msg = s2.store.failJob.mock.calls[0][1] as string;
    expect(msg.startsWith("Unexpected error: ")).toBe(true);
    expect(msg.length).toBeLessThanOrEqual("Unexpected error: ".length + 200);
  });
});
