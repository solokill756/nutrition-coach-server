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

  it("getQueryEmbedding caches results", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [1, 2, 3] }),
    } as any);
    const service = new VectorService(createConfig(false), createPostgres(false));
    const a = await service.getQueryEmbedding("hello");
    const b = await service.getQueryEmbedding("hello");
    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("vectorSearch works in memory mode", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [1, 0] }),
    } as any);
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
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [1, 0] }),
    } as any);
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
