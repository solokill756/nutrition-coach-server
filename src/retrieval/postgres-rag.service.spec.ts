import { PostgresRagService } from "./postgres-rag.service";

const queryMock = jest.fn();
const endMock = jest.fn();

jest.mock("pg", () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: queryMock,
    end: endMock,
  })),
}));

function createConfig(enabled = true) {
  return {
    get: jest.fn((k: string) => {
      const map: Record<string, string> = {
        USE_POSTGRES_STORAGE: enabled ? "true" : "false",
        POSTGRES_SCHEMA: "public",
        POSTGRES_VECTOR_DIM: "4",
        POSTGRES_EMBEDDING_MODEL: "nomic-embed-text",
        POSTGRES_VECTOR_INDEX_TYPE: "hnsw",
        POSTGRES_HOST: "localhost",
        POSTGRES_PORT: "5432",
        POSTGRES_USER: "postgres",
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_DB: "db",
      };
      return map[k];
    }),
  } as any;
}

describe("PostgresRagService", () => {
  beforeEach(() => {
    queryMock.mockReset();
    endMock.mockReset();
  });

  it("returns disabled state when storage off", async () => {
    const service = new PostgresRagService(createConfig(false));
    expect(service.isEnabled()).toBe(false);
    await expect(service.loadCorpus()).resolves.toEqual({ docs: [] });
  });

  it("ensureSchema issues SQL queries", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    const service = new PostgresRagService(createConfig(true));
    await service.ensureSchema();
    expect(queryMock).toHaveBeenCalled();
  });

  it("syncChunkEmbeddings handles empty records", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 }); // delete stale
    const service = new PostgresRagService(createConfig(true));
    const out = await service.syncChunkEmbeddings([], []);
    expect(out.failed).toBe(0);
  });

  it("vector searches map rows", async () => {
    queryMock.mockResolvedValue({ rows: [{ id: "a", score: 0.9 }], rowCount: 1 });
    const service = new PostgresRagService(createConfig(true));
    const byIds = await service.vectorSearchByDocIds([0.1, 0.2], ["a"], 1);
    const all = await service.vectorSearchAll([0.1, 0.2], 1);
    expect(byIds[0].docId).toBe("a");
    expect(all[0].docId).toBe("a");
  });

  it("loadCorpus parses docs", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "1", doc_id: "d", source: "s", title: "t", content: "c", metadata: { category: "guidelines" } }],
    });
    const service = new PostgresRagService(createConfig(true));
    const out = await service.loadCorpus();
    expect(out.docs.length).toBe(1);
  });

  it("onModuleDestroy closes pool", async () => {
    const service = new PostgresRagService(createConfig(true));
    await service.onModuleDestroy();
    expect(endMock).toHaveBeenCalled();
  });
});
