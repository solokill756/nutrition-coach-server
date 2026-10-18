import { VectorService } from "./vector.service";

function createConfig(pg = false) {
  return {
    get: jest.fn((k: string) => {
      const map: Record<string, string> = {
        USE_CHUNKING: "false",
        POSTGRES_ENABLE_PGVECTOR: pg ? "true" : "false",
      };
      return map[k];
    }),
  } as any;
}

function createPostgres(enabled = false) {
  return {
    isEnabled: jest.fn(() => enabled),
    ensureSchema: jest.fn().mockResolvedValue(undefined),
    getChunkEmbeddingHashes: jest.fn().mockResolvedValue(new Map()),
    syncChunkEmbeddings: jest.fn().mockResolvedValue({ added: 0, updated: 0, removed: 0, skipped: 0, failed: 0 }),
    vectorSearchByDocIds: jest.fn().mockResolvedValue([{ docId: "a", score: 0.8 }]),
    vectorSearchAll: jest.fn().mockResolvedValue([{ docId: "a", score: 0.8 }]),
  } as any;
}

describe("VectorService", () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    (global as any).fetch = fetchMock;
    fetchMock.mockReset();
  });

  afterAll(() => {
    (global as any).fetch = realFetch;
  });

  it("cosineSimilarity computes normalized score", () => {
    const service = new VectorService(createConfig(false), createPostgres(false));
    expect(service.cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 5);
  });

  const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as any;

  it("getQueryEmbedding keeps Vietnamese diacritics and uses the RAG model", async () => {
    fetchMock.mockResolvedValue(okJson({ embeddings: [[0.1, 0.2]] }));
    const service = new VectorService(createConfig(false), createPostgres(false));
    await service.getQueryEmbedding("  Người tiểu đường ");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/embed$/),
      expect.objectContaining({ body: JSON.stringify({ model: "bge-m3", input: ["Người tiểu đường"] }) }),
    );
  });

  it("embedDocuments batches by 8 sequentially and preserves order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    fetchMock.mockImplementation(async (_url: string, init: any) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      const input: string[] = JSON.parse(init.body).input;
      return okJson({ embeddings: input.map((t) => [Number(t.replace("t", ""))]) });
    });
    const service = new VectorService(createConfig(false), createPostgres(false));
    const texts = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const out = await service.embedDocuments(texts);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toHaveLength(8);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).input).toHaveLength(2);
    expect(maxInFlight).toBe(1);
    expect(out).toEqual(texts.map((_, i) => [i]));
  });

  it("getFoodQueryEmbedding keeps the old normalization and model", async () => {
    fetchMock.mockResolvedValue(okJson({ embedding: [0.5, 0.6] }));
    const service = new VectorService(createConfig(false), createPostgres(false));
    const out = await service.getFoodQueryEmbedding("Người tiểu đường");
    expect(out).toEqual([0.5, 0.6]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/embeddings$/),
      expect.objectContaining({
        body: JSON.stringify({ model: "nomic-embed-text", prompt: "nguoi tieu duong", stream: false }),
      }),
    );
  });

  it("getQueryEmbedding caches results", async () => {
    fetchMock.mockResolvedValue(okJson({ embeddings: [[1, 2, 3]] }));
    const service = new VectorService(createConfig(false), createPostgres(false));
    const a = await service.getQueryEmbedding("hello");
    const b = await service.getQueryEmbedding("hello");
    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("vectorSearch works in memory mode", async () => {
    fetchMock.mockResolvedValue(okJson({ embeddings: [[1, 0]] }));
    const service = new VectorService(createConfig(false), createPostgres(false));
    await service.onModuleInit();
    await service.embedDocument("doc a", "a");
    const q = await service.getQueryEmbedding("q");
    const out = await service.vectorSearch(q, ["a"], 1);
    expect(out.length).toBe(1);
  });

  it("vectorSearch delegates to postgres mode", async () => {
    const pg = createPostgres(true);
    const service = new VectorService(createConfig(true), pg);
    const out = await service.vectorSearch([1, 0], ["a"], 1);
    expect(out[0].docId).toBe("a");
    expect(pg.vectorSearchByDocIds).toHaveBeenCalled();
  });

  it("clearEmbeddings resets internal state", async () => {
    fetchMock.mockResolvedValue(okJson({ embeddings: [[1, 0]] }));
    const service = new VectorService(createConfig(false), createPostgres(false));
    await service.embedDocument("doc a", "a");
    await service.clearEmbeddings();
    expect(service.getCachedEmbedding("a")).toBeNull();
  });

  it("getQueryEmbedding throws when embedding endpoint is unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const service = new VectorService(createConfig(false), createPostgres(false));
    await expect(service.getQueryEmbedding("query that cannot be embedded")).rejects.toThrow();
  });
});
