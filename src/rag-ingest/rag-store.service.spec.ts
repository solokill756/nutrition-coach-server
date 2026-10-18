import { ReadyChunk, RagStoreService } from "./rag-store.service";
import { emptyTags } from "./rag-taxonomy";

type Call = { sql: string; params: unknown[] };

function makeStore(
  txHandler: (sql: string, params: unknown[]) => unknown,
  plainHandler?: (sql: string, params: unknown[]) => unknown,
  env: Record<string, string> = {}
) {
  const txCalls: Call[] = [];
  const plainCalls: Call[] = [];
  const manager = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      txCalls.push({ sql, params });
      return txHandler(sql, params);
    }),
  };
  const dataSource: any = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      plainCalls.push({ sql, params });
      return plainHandler ? plainHandler(sql, params) : [];
    }),
    transaction: jest.fn(async (cb: (m: any) => unknown) => cb(manager)),
  };
  const config: any = { get: (key: string) => env[key] };
  const store = new RagStoreService(dataSource, config);
  return { store, txCalls, plainCalls, dataSource };
}

const ready = (key: string, hash: string): ReadyChunk => ({
  chunkKey: key,
  headingPath: "H",
  pageFrom: 1,
  pageTo: 1,
  blockKind: "text",
  content: `content-${key}`,
  language: "en",
  sourceContentHash: hash,
  id: `doc-1-${key}`,
  domain: "guidelines",
  tags: emptyTags(),
  tagScores: {},
  tagger: "gemini",
  tagFailed: false,
  imagePath: null,
  embedding: [0.1, 0.2],
  embeddingHash: `eh-${key}`,
});

const docRow = {
  id: "doc-1",
  source_type: "url",
  source_url: "https://x.test/a",
  original_filename: null,
  title: "https://x.test/a",
};

describe("RagStoreService", () => {
  it("claimNextJob uses FOR UPDATE SKIP LOCKED", async () => {
    const { store, txCalls } = makeStore((sql) => {
      if (/UPDATE .*rag_ingest_jobs/s.test(sql)) {
        return [
          {
            id: "7",
            document_id: "doc-1",
            status: "running",
            stage: null,
            progress: 0,
            error_message: null,
            warnings: [],
            attempt: 1,
            started_at: null,
            finished_at: null,
            created_at: new Date(),
          },
        ];
      }
      return [];
    });
    const job = await store.claimNextJob();
    expect(job?.id).toBe("7");
    expect(job?.documentId).toBe("doc-1");
    expect(txCalls[0].sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(txCalls.some((c) => /UPDATE .*rag_documents/s.test(c.sql) && c.sql.includes("processing"))).toBe(true);
  });

  it("claimNextJob returns null when nothing is pending", async () => {
    const { store, txCalls } = makeStore(() => []);
    expect(await store.claimNextJob()).toBeNull();
    expect(txCalls).toHaveLength(1);
  });

  it("applyIngestResult returns documentMissing and writes nothing when the document row is gone", async () => {
    const { store, txCalls } = makeStore(() => []);
    const result = await store.applyIngestResult("doc-1", { title: "T", language: "en", chunks: [], draftKeys: [] });
    expect(result).toEqual({ documentMissing: true });
    expect(txCalls).toHaveLength(1);
    expect(txCalls[0].sql).toContain("FOR UPDATE");
    expect(txCalls.some((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql))).toBe(false);
  });

  it("plans from in-transaction chunk states, never overwriting a chunk locked by a concurrent admin edit", async () => {
    const { store, txCalls, plainCalls, dataSource } = makeStore((sql) => {
      if (/FROM .*rag_documents.*FOR UPDATE/s.test(sql)) return [docRow];
      if (/FROM .*rag_chunks.*FOR UPDATE/s.test(sql)) {
        // In the transaction, chunk c is already manually edited with an older source hash.
        return [{ id: "doc-1-c", chunk_key: "c", source_content_hash: "1", is_manually_edited: true }];
      }
      if (/count\(\*\)/i.test(sql)) return [{ count: 1 }];
      return [];
    });
    // Anything read outside the transaction says c is NOT edited; it must be ignored.
    jest.spyOn(store, "getExistingChunkStates").mockResolvedValue([
      { id: "doc-1-c", chunkKey: "c", sourceContentHash: "1", isManuallyEdited: false },
    ]);

    const result = await store.applyIngestResult("doc-1", {
      title: "T",
      language: "en",
      chunks: [],
      draftKeys: [{ chunkKey: "c", sourceContentHash: "2" }],
    });

    expect(result.plan?.flagReviewKeys).toEqual(["c"]);
    expect(result.plan?.replaceKeys).toEqual([]);
    expect(plainCalls).toHaveLength(0);
    expect(dataSource.query).not.toHaveBeenCalled();
    const rewritesContent = txCalls.some((c) => /UPDATE .*rag_chunks/s.test(c.sql) && /content\s*=/.test(c.sql));
    expect(rewritesContent).toBe(false);
    const flag = txCalls.find((c) => /UPDATE .*rag_chunks/s.test(c.sql) && c.sql.includes("needs_review = true"));
    expect(flag).toBeDefined();
    expect(flag!.params).toContain("doc-1-c");
    expect(flag!.params).toContain("2");
  });

  it("throws when the plan needs a chunk that has no ReadyChunk", async () => {
    const { store } = makeStore((sql) => {
      if (/FROM .*rag_documents.*FOR UPDATE/s.test(sql)) return [docRow];
      return [];
    });
    await expect(
      store.applyIngestResult("doc-1", { title: "T", language: "en", chunks: [], draftKeys: [{ chunkKey: "z", sourceContentHash: "1" }] })
    ).rejects.toThrow(/z/);
  });

  it("replace UPDATE never touches is_active, is_manually_edited or needs_review; insert writes embedding", async () => {
    const { store, txCalls } = makeStore((sql) => {
      if (/FROM .*rag_documents.*FOR UPDATE/s.test(sql)) return [docRow];
      if (/FROM .*rag_chunks.*FOR UPDATE/s.test(sql)) {
        return [
          { id: "doc-1-b", chunk_key: "b", source_content_hash: "1", is_manually_edited: false },
          { id: "doc-1-e", chunk_key: "e", source_content_hash: "1", is_manually_edited: false },
          { id: "doc-1-f", chunk_key: "f", source_content_hash: "1", is_manually_edited: true },
        ];
      }
      if (/count\(\*\)/i.test(sql)) return [{ count: 3 }];
      return [];
    });
    const result = await store.applyIngestResult("doc-1", {
      title: "New Title",
      language: "vi",
      chunks: [ready("b", "2"), ready("g", "1")],
      draftKeys: [
        { chunkKey: "b", sourceContentHash: "2" },
        { chunkKey: "g", sourceContentHash: "1" },
      ],
    });
    expect(result.documentMissing).toBe(false);
    expect(result.plan).toEqual({
      insertKeys: ["g"],
      replaceKeys: ["b"],
      unchangedKeys: [],
      flagReviewKeys: [],
      flagReviewMissingIds: ["doc-1-f"],
      deleteIds: ["doc-1-e"],
    });

    const chunkUpdates = txCalls.filter((c) => /UPDATE .*rag_chunks/s.test(c.sql));
    const replace = chunkUpdates.find((c) => /content\s*=/.test(c.sql));
    expect(replace).toBeDefined();
    for (const col of ["is_active", "is_manually_edited", "needs_review"]) {
      expect(replace!.sql).not.toContain(col);
    }
    expect(replace!.sql).toContain("source_content_hash");
    expect(chunkUpdates.some((c) => c.sql.includes("needs_review = true") && JSON.stringify(c.params).includes("doc-1-f"))).toBe(true);

    expect(txCalls.some((c) => /DELETE FROM .*rag_chunks/s.test(c.sql) && JSON.stringify(c.params).includes("doc-1-e"))).toBe(true);
    const insert = txCalls.find((c) => /INSERT INTO .*rag_chunks/s.test(c.sql));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain("doc-1-g");
    expect(insert!.params).toContain("https://x.test/a");
    const embeddings = txCalls.filter((c) => /INSERT INTO .*rag_embeddings/s.test(c.sql));
    expect(embeddings).toHaveLength(2);
    expect(embeddings[0].sql).toContain("ON CONFLICT (id) DO UPDATE");
    expect(embeddings[0].params).toContain("[0.1,0.2]");

    const docUpdate = txCalls.find((c) => /UPDATE .*rag_documents/s.test(c.sql));
    expect(docUpdate).toBeDefined();
    expect(docUpdate!.sql).toContain("status = 'ready'");
    expect(docUpdate!.params).toContain("New Title");
    expect(docUpdate!.params).toContain("vi");
  });

  it("does not interpolate values into SQL", async () => {
    const { store, txCalls } = makeStore((sql) => {
      if (/FROM .*rag_documents.*FOR UPDATE/s.test(sql)) return [docRow];
      if (/count\(\*\)/i.test(sql)) return [{ count: 1 }];
      return [];
    });
    await store.applyIngestResult("doc-1", {
      title: "T'; DROP TABLE x;--",
      language: "en",
      chunks: [ready("g", "1")],
      draftKeys: [{ chunkKey: "g", sourceContentHash: "1" }],
    });
    for (const c of txCalls) {
      expect(c.sql).not.toContain("DROP TABLE");
      expect(c.sql).not.toContain("content-g");
    }
  });

  it("embedding model falls back to POSTGRES_EMBEDDING_MODEL, then bge-m3", async () => {
    const handler = (sql: string) => {
      if (/FROM .*rag_documents.*FOR UPDATE/s.test(sql)) return [docRow];
      if (/count\(\*\)/i.test(sql)) return [{ count: 1 }];
      return [];
    };
    const input = { title: "T", language: "en" as const, chunks: [ready("g", "1")], draftKeys: [{ chunkKey: "g", sourceContentHash: "1" }] };
    const a = makeStore(handler, undefined, { POSTGRES_EMBEDDING_MODEL: "legacy-model" });
    await a.store.applyIngestResult("doc-1", input);
    expect(a.txCalls.find((c) => /INSERT INTO .*rag_embeddings/s.test(c.sql))!.params).toContain("legacy-model");
    const b = makeStore(handler);
    await b.store.applyIngestResult("doc-1", input);
    expect(b.txCalls.find((c) => /INSERT INTO .*rag_embeddings/s.test(c.sql))!.params).toContain("bge-m3");
    const c = makeStore(handler, undefined, { RAG_EMBEDDING_MODEL: "primary", POSTGRES_EMBEDDING_MODEL: "legacy-model" });
    await c.store.applyIngestResult("doc-1", input);
    expect(c.txCalls.find((x) => /INSERT INTO .*rag_embeddings/s.test(x.sql))!.params).toContain("primary");
  });

  it("deleteDocument issues a single DELETE on rag_documents and never deletes chunks first", async () => {
    const { store, plainCalls, txCalls, dataSource } = makeStore(
      () => [],
      (sql) => (/DELETE FROM .*rag_documents/s.test(sql) ? [{ id: "doc-1" }] : [])
    );
    expect(await store.deleteDocument("doc-1")).toBe(true);
    expect(plainCalls).toHaveLength(1);
    expect(plainCalls[0].sql).toMatch(/DELETE FROM .*rag_documents/s);
    expect(txCalls).toHaveLength(0);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(plainCalls.some((c) => /rag_chunks/.test(c.sql))).toBe(false);
  });

  it("failJob and finishJob tolerate zero updated rows", async () => {
    const { store } = makeStore(() => [], () => []);
    await expect(store.failJob("1", "boom", [])).resolves.toBeUndefined();
    await expect(store.finishJob("1", [])).resolves.toBeUndefined();
  });

  it("enqueueJob sets attempt to previous count plus one and document pending", async () => {
    const { store, txCalls } = makeStore((sql) => {
      if (/INSERT INTO .*rag_ingest_jobs/s.test(sql)) {
        return [
          { id: "3", document_id: "doc-1", status: "pending", stage: null, progress: 0, error_message: null, warnings: [], attempt: 3, started_at: null, finished_at: null, created_at: new Date() },
        ];
      }
      return [];
    });
    const job = await store.enqueueJob("doc-1");
    expect(job.attempt).toBe(3);
    const insert = txCalls.find((c) => /INSERT INTO .*rag_ingest_jobs/s.test(c.sql))!;
    expect(insert.sql).toMatch(/count\(\*\)::int\s*\+\s*1/i);
    expect(txCalls.some((c) => /UPDATE .*rag_documents/s.test(c.sql) && c.sql.includes("pending"))).toBe(true);
  });

  it("listDocuments joins latest job laterally and counts separately", async () => {
    const { store, plainCalls } = makeStore(
      () => [],
      (sql) => {
        if (/count\(\*\)/i.test(sql)) return [{ count: "5" }];
        return [];
      }
    );
    const out = await store.listDocuments({ search: "abc", page: 2, limit: 10 });
    expect(out.total).toBe(5);
    const list = plainCalls.find((c) => c.sql.includes("LATERAL"))!;
    expect(list.sql).toContain("ORDER BY created_at DESC LIMIT 1");
    expect(list.sql).toContain("ILIKE");
    expect(list.params).toContain("%abc%");
    expect(list.params).toContain(10);
    expect(list.params).toContain(10); // offset = (2-1)*10
  });
});
