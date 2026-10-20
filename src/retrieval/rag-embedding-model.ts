import { ConfigService } from "@nestjs/config";

export const DEFAULT_RAG_EMBEDDING_MODEL = "bge-m3";

/**
 * The one source of the RAG embedding model name: RAG_EMBEDDING_MODEL, else bge-m3.
 * Used both to embed (VectorService) and to label rag_embeddings rows (store, PostgresRagService,
 * admin edits), so the label always matches the model that made the vector.
 * POSTGRES_EMBEDDING_MODEL is deliberately NOT a fallback: it names the old/food model.
 */
export function resolveRagEmbeddingModel(config: Pick<ConfigService, "get">): string {
  return config.get<string>("RAG_EMBEDDING_MODEL") || DEFAULT_RAG_EMBEDDING_MODEL;
}
