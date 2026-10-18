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
        RAG_EMBEDDING_DIM: "1024",
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

  it("ensureSchema creates rag_documents, rag_ingest_jobs and new chunk columns", async () => {
    queryMock.mockResolvedValue({ rows: [{ atttypmod: 1024 }], rowCount: 1 });
    await new PostgresRagService(createConfig(true)).ensureSchema();
    const sql = queryMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."rag_documents"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."rag_ingest_jobs"/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS is_manually_edited boolean/);
    expect(sql).toMatch(/vector\(1024\)/);
  });

  it("ensureSchema runs once for concurrent callers (VectorService and RetrievalService boot together)", async () => {
    // Two parallel CREATE TABLE IF NOT EXISTS on a fresh DB collide on pg_type_typname_nsp_index.
    queryMock.mockResolvedValue({ rows: [{ atttypmod: 1024 }], rowCount: 1 });
    const service = new PostgresRagService(createConfig(true));
    await Promise.all([service.ensureSchema(), service.ensureSchema()]);
    const createExtension = queryMock.mock.calls.filter((c) => /CREATE EXTENSION/.test(String(c[0])));
    expect(createExtension).toHaveLength(1);
  });

  it("ensureSchema can be retried after a failure", async () => {
    queryMock.mockRejectedValueOnce(new Error("db down"));
    const service = new PostgresRagService(createConfig(true));
    await expect(service.ensureSchema()).rejects.toThrow(/pgvector extension unavailable/);
    queryMock.mockResolvedValue({ rows: [{ atttypmod: 1024 }], rowCount: 1 });
    await expect(service.ensureSchema()).resolves.toBeUndefined();
  });

  it("checkEmbeddingDimension reports mismatch", async () => {
    queryMock.mockResolvedValue({ rows: [{ atttypmod: 768 }], rowCount: 1 });
    await expect(new PostgresRagService(createConfig(true)).checkEmbeddingDimension()).resolves.toEqual({
      ok: false,
      actual: 768,
      expected: 1024,
    });
  });

  it("checkEmbeddingDimension returns actual null when table missing", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(new PostgresRagService(createConfig(true)).checkEmbeddingDimension()).resolves.toEqual({
      ok: false,
      actual: null,
      expected: 1024,
    });
  });

  it("loadCorpus maps active chunks with tags, heading title and link", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "d1-k1",
          doc_id: "d1",
          source: "who.int",
          title: "Healthy diet",
          heading_path: "Salt",
          content: "Keep salt < 5 g",
          metadata: {},
          domain: "guidelines",
          tags: { nutrients: ["sodium"] },
          page_from: null,
          block_kind: "text",
          source_url: "https://who.int/x",
        },
      ],
    });
    const { docs } = await new PostgresRagService(createConfig(true)).loadCorpus();
    expect(docs[0]).toMatchObject({
      id: "d1-k1",
      title: "Healthy diet › Salt",
      metadata: { domain: "guidelines", tags: { nutrients: ["sodium"] }, link: "https://who.int/x" },
    });
    expect(String(queryMock.mock.calls.at(-1)![0])).toMatch(/is_active = true/);
  });

  it("loadCorpus tolerates legacy rows without new columns", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "1", doc_id: "d", source: "s", title: "t", content: "c", metadata: { domain: "old" }, domain: null, heading_path: null }],
    });
    const { docs } = await new PostgresRagService(createConfig(true)).loadCorpus();
    expect(docs[0].title).toBe("t");
    expect(docs[0].metadata.domain).toBe("old");
  });

  it("onModuleDestroy closes pool", async () => {
    const service = new PostgresRagService(createConfig(true));
    await service.onModuleDestroy();
    expect(endMock).toHaveBeenCalled();
  });
});
