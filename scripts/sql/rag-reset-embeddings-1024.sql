-- Reset the RAG embeddings table so it is recreated with vector(1024).
-- The server recreates public.rag_embeddings (vector(RAG_EMBEDDING_DIM), default 1024) at startup via ensureSchema().
-- The old knowledge base has been discarded, so there is no embedding data worth keeping.
DROP TABLE IF EXISTS public.rag_embeddings;
