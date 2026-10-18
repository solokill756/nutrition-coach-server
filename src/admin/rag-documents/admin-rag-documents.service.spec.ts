import { Logger } from "@nestjs/common";
import { RAG_TAXONOMY } from "../../rag-ingest/rag-taxonomy";
import { AdminRagException } from "./admin-rag-documents.exception";
import { AdminRagDocumentsService } from "./admin-rag-documents.service";

const NOW = new Date("2026-10-18T00:00:00.000Z");

const doc = (o: Record<string, unknown> = {}) => ({
  id: "d1",
  sourceType: "url",
  sourceUrl: "https://who.int/x",
  originalFilename: null,
  filePath: null,
  fileHash: null,
  title: "Doc title",
  language: "en",
  status: "ready",
  chunkCount: 1,
  createdBy: 1,
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
});

const chunk = (o: Record<string, unknown> = {}) => ({
  id: "d1-c1",
  docId: "d1",
  chunkKey: "c1",
  source: "",
  title: "Doc title",
  content: "hello",
  metadata: { tagger: "jev" },
  contentHash: null,
  headingPath: "H1 > H2",
  pageFrom: 1,
  pageTo: 2,
  blockKind: "text",
  imagePath: null,
  language: "en",
  domain: "guidelines",
  tags: { conditions: [], allergens: [], goals: [], nutrients: [] },
  tagScores: {},
  isActive: true,
  isManuallyEdited: false,
  needsReview: false,
  sourceContentHash: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
});

const job = (o: Record<string, unknown> = {}) => ({
  id: "7",
  documentId: "d1",
  status: "pending",
  stage: null,
  progress: 0,
  errorMessage: null,
  warnings: [],
  attempt: 1,
  startedAt: null,
  finishedAt: null,
  createdAt: NOW,
  ...o,
});

const PDF = Buffer.from("%PDF-1.7 fake");

function setup() {
  const store = {
    findDocumentBySourceUrl: jest.fn().mockResolvedValue(null),
    findDocumentByFileHash: jest.fn().mockResolvedValue(null),
    createDocument: jest.fn().mockResolvedValue(doc()),
    updateDocument: jest.fn().mockResolvedValue(doc()),
    getDocument: jest.fn().mockResolvedValue(doc()),
    getLatestJob: jest.fn().mockResolvedValue(job()),
    listDocuments: jest.fn().mockResolvedValue({ rows: [{ ...doc(), latestJob: null }], total: 41 }),
    enqueueJob: jest.fn().mockResolvedValue(job()),
    hasActiveJob: jest.fn().mockResolvedValue(false),
    deleteDocument: jest.fn().mockResolvedValue(true),
    listChunks: jest.fn().mockResolvedValue([chunk()]),
    getChunk: jest.fn().mockResolvedValue(chunk()),
    updateChunk: jest.fn().mockImplementation(async (_id: string, p: Record<string, unknown>) => chunk(p)),
    upsertEmbedding: jest.fn().mockResolvedValue(undefined),
    hasEmbedding: jest.fn().mockResolvedValue(true),
  };
  const storage = {
    saveSourcePdf: jest.fn().mockResolvedValue("documents/d1/source.pdf"),
    readFile: jest.fn().mockResolvedValue(Buffer.from("img")),
    deleteDocumentDir: jest.fn().mockResolvedValue(undefined),
  };
  const tagging = {
    tagOne: jest.fn().mockResolvedValue({
      domain: "safety",
      tags: { conditions: ["diabetes"], allergens: [], goals: [], nutrients: [] },
      scores: { "domain:safety": 0.9 },
      tagger: "gemini",
    }),
  };
  const vector = { embedDocuments: jest.fn().mockResolvedValue([[0.1, 0.2]]) };
  const retrieval = { scheduleRebuild: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const service = new AdminRagDocumentsService(
    store as never,
    storage as never,
    tagging as never,
    vector as never,
    retrieval as never,
    config as never,
  );
  return { service, store, storage, tagging, vector, retrieval, config };
}

async function codeOf(p: Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await p;
  } catch (e) {
    const ex = e as AdminRagException;
    return { code: ex.code, status: ex.getStatus() };
  }
  throw new Error("expected rejection");
}

describe("AdminRagDocumentsService", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe("addUrl", () => {
    it("returns the existing document (created:false) for an equivalent url and does not enqueue", async () => {
      const t = setup();
      t.store.findDocumentBySourceUrl.mockResolvedValue(doc());
      const res = await t.service.addUrl("https://WHO.int/x/", 5);
      expect(t.store.findDocumentBySourceUrl).toHaveBeenCalledWith("https://who.int/x");
      expect(res.created).toBe(false);
      expect(res.data.id).toBe("d1");
      expect(t.store.enqueueJob).not.toHaveBeenCalled();
      expect(t.store.createDocument).not.toHaveBeenCalled();
    });

    it("creates with title = normalized url, createdBy and enqueues", async () => {
      const t = setup();
      const res = await t.service.addUrl("https://WHO.int/x/", 5);
      expect(t.store.createDocument).toHaveBeenCalledWith({
        sourceType: "url",
        sourceUrl: "https://who.int/x",
        title: "https://who.int/x",
        createdBy: 5,
      });
      expect(t.store.enqueueJob).toHaveBeenCalledWith("d1");
      expect(t.retrieval.scheduleRebuild).not.toHaveBeenCalled();
      expect(res.created).toBe(true);
      expect(res.data.latestJob?.id).toBe("7");
    });

    it("rejects an invalid url", async () => {
      const t = setup();
      expect(await codeOf(t.service.addUrl("ftp://x", 1))).toEqual({ code: "RAG_INVALID_URL", status: 400 });
    });
  });

  describe("uploadPdf", () => {
    it("rejects a buffer without the %PDF- magic", async () => {
      const t = setup();
      const res = await codeOf(
        t.service.uploadPdf({ originalname: "a.pdf", mimetype: "application/pdf", buffer: Buffer.from("<html>") }, 1),
      );
      expect(res).toEqual({ code: "RAG_INVALID_FILE", status: 400 });
    });

    it("rejects a wrong mimetype and a missing file", async () => {
      const t = setup();
      expect((await codeOf(t.service.uploadPdf({ originalname: "a.pdf", mimetype: "text/plain", buffer: PDF }, 1))).code).toBe(
        "RAG_INVALID_FILE",
      );
      expect((await codeOf(t.service.uploadPdf(undefined, 1))).code).toBe("RAG_INVALID_FILE");
    });

    it("returns created:false for a duplicate hash", async () => {
      const t = setup();
      t.store.findDocumentByFileHash.mockResolvedValue(doc({ sourceType: "pdf" }));
      const res = await t.service.uploadPdf({ originalname: "a.pdf", mimetype: "application/pdf", buffer: PDF }, 1);
      expect(res.created).toBe(false);
      expect(t.store.createDocument).not.toHaveBeenCalled();
      expect(t.store.enqueueJob).not.toHaveBeenCalled();
    });

    it("creates with the filename minus .pdf (case-insensitive), saves the file, then enqueues", async () => {
      const t = setup();
      const res = await t.service.uploadPdf({ originalname: "Guide v2.PDF", mimetype: "application/pdf", buffer: PDF }, 9);
      expect(t.store.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: "pdf",
          originalFilename: "Guide v2.PDF",
          title: "Guide v2",
          createdBy: 9,
          fileHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      );
      expect(t.storage.saveSourcePdf).toHaveBeenCalledWith("d1", PDF);
      expect(t.store.updateDocument).toHaveBeenCalledWith("d1", { filePath: "documents/d1/source.pdf" });
      expect(t.store.enqueueJob).toHaveBeenCalledWith("d1");
      expect(res.created).toBe(true);
    });
  });

  describe("unicode normalization", () => {
    it("stores an NFD filename as NFC for both originalFilename and title", async () => {
      const t = setup();
      const nfd = "Hương dẫn.pdf".normalize("NFD");
      const nfc = nfd.normalize("NFC");
      expect(nfd).not.toBe(nfc);
      await t.service.uploadPdf({ originalname: nfd, mimetype: "application/pdf", buffer: PDF }, 1);
      const arg = t.store.createDocument.mock.calls[0][0];
      expect(arg.originalFilename).toBe(nfc);
      expect(arg.title).toBe(nfc.replace(/\.pdf$/i, ""));
    });

    it("rename stores NFC", async () => {
      const t = setup();
      const nfd = "Dinh dũơng".normalize("NFD");
      await t.service.renameDocument("d1", nfd);
      expect(t.store.updateDocument).toHaveBeenCalledWith("d1", { title: nfd.normalize("NFC") });
    });
  });

  describe("documents", () => {
    it("lists with pagination and ISO dates", async () => {
      const t = setup();
      const res = await t.service.listDocuments({ page: 2, limit: 20 });
      expect(res.pagination).toEqual({ page: 2, limit: 20, total: 41, totalPages: 3 });
      expect(res.data[0].createdAt).toBe(NOW.toISOString());
      expect(res.data[0].latestJob).toBeNull();
    });

    it("404s on unknown document", async () => {
      const t = setup();
      t.store.getDocument.mockResolvedValue(null);
      expect(await codeOf(t.service.getDocument("x"))).toEqual({ code: "RAG_DOCUMENT_NOT_FOUND", status: 404 });
    });

    it("renames the document", async () => {
      const t = setup();
      t.store.updateDocument.mockResolvedValue(doc({ title: "New" }));
      const res = await t.service.renameDocument("d1", "  New ");
      expect(t.store.updateDocument).toHaveBeenCalledWith("d1", { title: "New" });
      expect(res.data.title).toBe("New");
    });

    it("reingest rejects when a job is active", async () => {
      const t = setup();
      t.store.hasActiveJob.mockResolvedValue(true);
      expect(await codeOf(t.service.reingest("d1"))).toEqual({ code: "RAG_JOB_IN_PROGRESS", status: 409 });
      expect(t.store.enqueueJob).not.toHaveBeenCalled();
    });

    it("reingest enqueues otherwise", async () => {
      const t = setup();
      const res = await t.service.reingest("d1");
      expect(t.store.enqueueJob).toHaveBeenCalledWith("d1");
      expect(res.data.id).toBe("d1");
    });

    it("delete removes the row, then the directory, then schedules a rebuild", async () => {
      const t = setup();
      const order: string[] = [];
      t.store.deleteDocument.mockImplementation(async () => (order.push("db"), true));
      t.storage.deleteDocumentDir.mockImplementation(async () => void order.push("dir"));
      t.retrieval.scheduleRebuild.mockImplementation(() => void order.push("rebuild"));
      const res = await t.service.deleteDocument("d1");
      expect(order).toEqual(["db", "dir", "rebuild"]);
      expect(res.success).toBe(true);
    });

    it("delete 404s when the document is missing", async () => {
      const t = setup();
      t.store.getDocument.mockResolvedValue(null);
      expect((await codeOf(t.service.deleteDocument("d1"))).code).toBe("RAG_DOCUMENT_NOT_FOUND");
      expect(t.storage.deleteDocumentDir).not.toHaveBeenCalled();
    });
  });

  describe("chunks", () => {
    it("maps the chunk dto from metadata", async () => {
      const t = setup();
      t.store.listChunks.mockResolvedValue([chunk({ metadata: { tagger: "gemini", tagError: true }, imagePath: "documents/d1/images/a.png" })]);
      const res = await t.service.listChunks("d1", {});
      expect(res.data[0]).toMatchObject({
        tagger: "gemini",
        tagFailed: true,
        hasImage: true,
        updatedAt: NOW.toISOString(),
        blockKind: "text",
      });
    });

    it("rejects invalid tags without writing", async () => {
      const t = setup();
      const res = await codeOf(t.service.updateChunk("d1-c1", { tags: { conditions: ["cancer"] } as never }));
      expect(res).toEqual({ code: "RAG_INVALID_TAG", status: 400 });
      expect(t.store.updateChunk).not.toHaveBeenCalled();
    });

    it("rejects an invalid domain", async () => {
      const t = setup();
      expect((await codeOf(t.service.updateChunk("d1-c1", { domain: "nope" as never }))).code).toBe("RAG_INVALID_DOMAIN");
      expect(t.store.updateChunk).not.toHaveBeenCalled();
    });

    it("content edit: one atomic update, multiline normalize, re-embed with title, rebuild", async () => {
      const t = setup();
      await t.service.updateChunk("d1-c1", { content: "line  one\n\n\n\nline two  " });
      expect(t.store.updateChunk).toHaveBeenCalledTimes(1);
      expect(t.store.updateChunk).toHaveBeenCalledWith("d1-c1", {
        content: "line one\n\nline two",
        isManuallyEdited: true,
      });
      expect(t.vector.embedDocuments).toHaveBeenCalledWith(["Doc title\nH1 > H2\nline one\n\nline two"]);
      expect(t.store.upsertEmbedding).toHaveBeenCalledWith(
        "d1-c1",
        [0.1, 0.2],
        expect.stringMatching(/^[0-9a-f]{64}$/),
        "bge-m3",
      );
      expect(t.retrieval.scheduleRebuild).toHaveBeenCalledTimes(1);
    });

    it("uses the configured embedding model", async () => {
      const t = setup();
      t.config.get.mockImplementation((k: string) => (k === "POSTGRES_EMBEDDING_MODEL" ? "m2" : undefined));
      await t.service.updateChunk("d1-c1", { content: "x" });
      expect(t.store.upsertEmbedding.mock.calls[0][3]).toBe("m2");
    });

    it("keeps the save and returns 502 RAG_EMBEDDING_FAILED when embedding fails", async () => {
      const t = setup();
      t.vector.embedDocuments.mockRejectedValue(Object.assign(new Error("boom key=SECRET"), { config: { headers: { a: "SECRET" } } }));
      const res = await codeOf(t.service.updateChunk("d1-c1", { content: "x" }));
      expect(res).toEqual({ code: "RAG_EMBEDDING_FAILED", status: 502 });
      expect(t.store.updateChunk).toHaveBeenCalledTimes(1);
      expect(t.retrieval.scheduleRebuild).toHaveBeenCalled();
    });

    it("maps a deleted row (updateChunk -> null) to RAG_CHUNK_NOT_FOUND", async () => {
      const t = setup();
      t.store.updateChunk.mockResolvedValue(null);
      expect(await codeOf(t.service.updateChunk("d1-c1", { content: "x" }))).toEqual({ code: "RAG_CHUNK_NOT_FOUND", status: 404 });
      expect(t.vector.embedDocuments).not.toHaveBeenCalled();
    });

    it("tag/domain edits mark the chunk manually edited", async () => {
      const t = setup();
      await t.service.updateChunk("d1-c1", { domain: "safety", tags: { conditions: ["diabetes"] } as never });
      const patch = t.store.updateChunk.mock.calls[0][1];
      expect(patch).toMatchObject({ domain: "safety", isManuallyEdited: true });
      expect(patch.tags.conditions).toEqual(["diabetes"]);
      expect(t.vector.embedDocuments).not.toHaveBeenCalled();
    });

    it("isActive-only edit does not set isManuallyEdited", async () => {
      const t = setup();
      await t.service.updateChunk("d1-c1", { isActive: false });
      expect(t.store.updateChunk).toHaveBeenCalledWith("d1-c1", { isActive: false });
      expect(t.retrieval.scheduleRebuild).toHaveBeenCalled();
    });

    it("re-enabling a chunk that has no rag_embeddings row embeds it with buildEmbeddingText", async () => {
      const t = setup();
      t.store.hasEmbedding.mockResolvedValue(false);
      const res = await t.service.updateChunk("d1-c1", { isActive: true });
      expect(t.store.updateChunk).toHaveBeenCalledWith("d1-c1", { isActive: true });
      expect(t.store.hasEmbedding).toHaveBeenCalledWith("d1-c1");
      expect(t.vector.embedDocuments).toHaveBeenCalledWith(["Doc title\nH1 > H2\nhello"]);
      expect(t.store.upsertEmbedding).toHaveBeenCalledWith("d1-c1", [0.1, 0.2], expect.stringMatching(/^[0-9a-f]{64}$/), "bge-m3");
      expect(t.retrieval.scheduleRebuild).toHaveBeenCalledTimes(1);
      expect(res.data.isActive).toBe(true);
    });

    it("re-enabling a chunk that still has its embedding does not re-embed; disabling never embeds", async () => {
      const t = setup();
      await t.service.updateChunk("d1-c1", { isActive: true });
      expect(t.store.hasEmbedding).toHaveBeenCalledWith("d1-c1");
      expect(t.vector.embedDocuments).not.toHaveBeenCalled();
      await t.service.updateChunk("d1-c1", { isActive: false });
      expect(t.store.hasEmbedding).toHaveBeenCalledTimes(1);
      expect(t.vector.embedDocuments).not.toHaveBeenCalled();
    });

    it("re-enabling keeps the save and returns 502 RAG_EMBEDDING_FAILED when the missing embedding cannot be built", async () => {
      const t = setup();
      t.store.hasEmbedding.mockResolvedValue(false);
      t.vector.embedDocuments.mockRejectedValue(new Error("ollama down"));
      expect(await codeOf(t.service.updateChunk("d1-c1", { isActive: true }))).toEqual({ code: "RAG_EMBEDDING_FAILED", status: 502 });
      expect(t.store.updateChunk).toHaveBeenCalledTimes(1);
      expect(t.retrieval.scheduleRebuild).toHaveBeenCalled();
    });

    it("404s when the chunk does not exist", async () => {
      const t = setup();
      t.store.updateChunk.mockResolvedValue(null);
      expect((await codeOf(t.service.updateChunk("zz", { isActive: false }))).code).toBe("RAG_CHUNK_NOT_FOUND");
    });

    it("retag overwrites tags and clears the error without touching isManuallyEdited", async () => {
      const t = setup();
      await t.service.retag("d1-c1");
      expect(t.tagging.tagOne).toHaveBeenCalledWith("hello");
      const patch = t.store.updateChunk.mock.calls[0][1];
      expect(patch).toEqual({
        domain: "safety",
        tags: { conditions: ["diabetes"], allergens: [], goals: [], nutrients: [] },
        tagScores: { "domain:safety": 0.9 },
        tagger: "gemini",
        clearTagError: true,
      });
      expect(patch).not.toHaveProperty("isManuallyEdited");
      expect(t.retrieval.scheduleRebuild).toHaveBeenCalled();
    });

    it("retag failure -> 502 RAG_TAGGING_FAILED, logs no error object", async () => {
      const t = setup();
      const warn = jest.spyOn(Logger.prototype, "warn");
      t.tagging.tagOne.mockRejectedValue(Object.assign(new Error("bad"), { config: { headers: { Authorization: "Bearer SECRET" } } }));
      expect(await codeOf(t.service.retag("d1-c1"))).toEqual({ code: "RAG_TAGGING_FAILED", status: 502 });
      expect(t.store.updateChunk).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET");
    });

    it("resolve-review clears needsReview and rebuilds", async () => {
      const t = setup();
      await t.service.resolveReview("d1-c1");
      expect(t.store.updateChunk).toHaveBeenCalledWith("d1-c1", { needsReview: false });
      expect(t.retrieval.scheduleRebuild).toHaveBeenCalled();
    });
  });

  describe("image", () => {
    it("returns the buffer with a content type from the extension", async () => {
      const t = setup();
      t.store.getChunk.mockResolvedValue(chunk({ imagePath: "documents/d1/images/a.jpg" }));
      const res = await t.service.getChunkImage("d1-c1");
      expect(t.storage.readFile).toHaveBeenCalledWith("documents/d1/images/a.jpg");
      expect(res.contentType).toBe("image/jpeg");
      expect(res.buffer.toString()).toBe("img");
    });

    it("404s without imagePath or when the file is missing", async () => {
      const t = setup();
      expect((await codeOf(t.service.getChunkImage("d1-c1"))).code).toBe("RAG_IMAGE_NOT_FOUND");
      t.store.getChunk.mockResolvedValue(chunk({ imagePath: "documents/d1/images/a.png" }));
      t.storage.readFile.mockRejectedValue(new Error("ENOENT"));
      expect(await codeOf(t.service.getChunkImage("d1-c1"))).toEqual({ code: "RAG_IMAGE_NOT_FOUND", status: 404 });
    });
  });

  it("getTaxonomy returns RAG_TAXONOMY groups and domains", () => {
    const t = setup();
    const res = t.service.getTaxonomy();
    expect(res.data.groups).toBe(RAG_TAXONOMY);
    expect(res.data.domains.map((d) => d.key)).toEqual(["guidelines", "conditions", "safety"]);
  });
});
