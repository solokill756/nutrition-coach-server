import { resolveRagEmbeddingModel } from "./rag-embedding-model";

const cfg = (env: Record<string, string>) => ({ get: (k: string) => env[k] }) as any;

describe("resolveRagEmbeddingModel", () => {
  it("uses RAG_EMBEDDING_MODEL when set", () => {
    expect(resolveRagEmbeddingModel(cfg({ RAG_EMBEDDING_MODEL: "bge-m3-custom" }))).toBe("bge-m3-custom");
  });

  it("defaults to bge-m3 and never falls back to POSTGRES_EMBEDDING_MODEL (food/legacy model)", () => {
    expect(resolveRagEmbeddingModel(cfg({}))).toBe("bge-m3");
    expect(resolveRagEmbeddingModel(cfg({ POSTGRES_EMBEDDING_MODEL: "nomic-embed-text" }))).toBe("bge-m3");
  });
});
