# Nutrition Coach Server (NestJS + Ollama)

## 1) Prerequisites

- Node.js 20+
- Ollama installed
- Model pulled: llama3:8b

## 2) Ollama setup

1. Start Ollama service

- ollama serve

1. Pull model

- ollama pull llama3:8b

1. Test model quickly

- ollama run llama3:8b "hello"

## 3) Server setup

1. Go to server folder

- cd nutrition-coach-server

1. Create env file

- copy .env.example .env

1. Install deps (if not installed)

- npm install

1. Start dev server

- npm run start:dev

## 4) Build and run

- npm run build
- npm run start

## 5) API

### Swagger

- UI: http://localhost:3001/docs — raw spec: http://localhost:3001/docs-json
- Log in with POST /auth/login (or /admin/auth/login), copy `accessToken` into **Authorize**; it is kept across reloads.
- On unless `NODE_ENV=production`; the Docker image sets that, so add `SWAGGER_ENABLED=true` to `.env` to see it there (or `false` to hide it anywhere).
- Body and query schemas come from the DTOs' class-validator decorators, so no `@ApiProperty` is needed. Add one only to override what is generated.

### Health

- GET /health

### Coach chat

- POST /coach/chat
- Body example:

{
  "question": "Toi bi tang huyet ap, nen an gi de giam sodium?",
  "profile": {
    "age": 27,
    "conditions": ["hypertension"],
    "allergies": ["peanut"],
    "goal": "giam huyet ap"
  }
}

## 6) Notes

- The server retrieves evidence from JSONL files under ../nutrition-rag-data/data.
- If Ollama is unavailable, the server returns a safe fallback summary with evidence IDs.

## 7) Push Notification Environment

FCM sends use Firebase Admin credentials.

- `FIREBASE_SERVICE_ACCOUNT_PATH`: path to a Firebase service account JSON file.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: raw service account JSON for hosted environments.
- `NOTIFICATIONS_SCHEDULER_ENABLED`: set to `true` to run daily reminder sends every minute.

Use only one Firebase credential option. Keep scheduler disabled until device token registration and admin broadcast are verified.

## 8) RAG knowledge base

Admins build the RAG knowledge base from the admin API (`/admin/rag/...`): add a web page URL or upload a PDF
(max 50 MB). A background worker converts it with Docling, transcribes informative images with Gemini, splits it
into chunks, tags each chunk with Jev (TypeSafe), with Gemini as fallback, embeds it with `bge-m3` on Ollama, and
stores it in `rag_chunks` / `rag_embeddings`. Retrieval picks up every change without a restart.

### Setup

1. Pull the embedding model (RAG uses `bge-m3`, 1024 dims; food search keeps `nomic-embed-text`):

   ```
   ollama pull bge-m3
   ```

   Ollama hosts both models, and the ingest worker shares the machine with user traffic. Run Ollama with:

   ```
   OLLAMA_MAX_LOADED_MODELS=2
   OLLAMA_NUM_PARALLEL=1
   ```

2. Start docling-serve (pinned image, 4 GB memory limit, one worker) on port 5001:

   ```
   docker compose -f docker-compose.rag.yml up -d
   ```

   The compose file sets `DOCLING_SERVE_MAX_DOCUMENT_TIMEOUT` and `DOCLING_SERVE_MAX_SYNC_WAIT` to `3500` seconds.
   Keep both at or below `DOCLING_TIMEOUT_MS / 1000` (default 3600). docling-serve does not cancel a conversion the
   API server gave up on, so with one worker a higher server cap lets an abandoned conversion block the next job.

3. If the database still has the old `rag_embeddings` table with `vector(768)`, the server logs
   `rag_embeddings.embedding has dimension 768 but RAG_EMBEDDING_DIM=1024` at startup. Drop the table and restart
   the server, which recreates it as `vector(1024)`. The old embeddings are not needed, because the old corpus was
   discarded:

   ```
   psql -h <host> -p <port> -U <user> -d <db> -f scripts/sql/rag-reset-embeddings-1024.sql
   ```

   **This script is destructive.** It drops `rag_embeddings`, which deletes every RAG embedding row. Run it only once,
   when the log above shows the old 768 dimension, and before you ingest documents. If you run it after ingesting,
   every chunk loses vector search, and re-ingesting does not bring back unchanged chunks (their embedding is kept,
   not rebuilt): you would have to delete and re-add each document. The script assumes the `public` schema. If
   `POSTGRES_SCHEMA` is something else, change `public.rag_embeddings` in the script first.

   Migrating an old database: legacy `rag_chunks` rows from the old corpus have no `rag_documents` row
   (`chunk_key IS NULL`). Retrieval still serves them, but the admin pages cannot see or edit them. Delete them once:

   ```sql
   DELETE FROM public.rag_chunks c
   WHERE c.chunk_key IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.rag_documents d WHERE d.id = c.doc_id);
   ```

   Their `rag_embeddings` rows are deleted with them (`ON DELETE CASCADE`).

4. Create a new Jev (TypeSafe) API key for this deployment and put it in `TYPESAFE_API_KEY`. Never reuse a key that
   has been shared or committed. Without a key, tagging falls back to Gemini (through `LLM_PROVIDER`).

5. Add the new `.env` variables (see `.env.example`):

   | Variable | Default | Purpose |
   |---|---|---|
   | `RAG_EMBEDDING_MODEL` | `bge-m3` | Ollama model for RAG chunks and RAG queries, and the `model` label on `rag_embeddings` rows. Set it explicitly; `POSTGRES_EMBEDDING_MODEL` is not used for RAG |
   | `RAG_EMBEDDING_DIM` | `1024` | Must match `rag_embeddings.embedding` |
   | `FOOD_EMBEDDING_MODEL` | `nomic-embed-text` | Food semantic search model (unchanged) |
   | `POSTGRES_SYNC_EMBEDDINGS_ON_BOOT` | `false` | Ignored (a startup log line says so): the ingest worker owns RAG embeddings now |
   | `DOCLING_URL` | `http://localhost:5001` | docling-serve base URL |
   | `DOCLING_TIMEOUT_MS` | `3600000` | Deadline for one document conversion. Keep the compose `DOCLING_SERVE_MAX_DOCUMENT_TIMEOUT` (seconds) at or below this value / 1000 |
   | `RAG_STORAGE_DIR` | `./storage/rag` | Uploaded PDFs and extracted images |
   | `TYPESAFE_API_KEY` | (empty) | Jev key for chunk tagging |
   | `TYPESAFE_API_URL` | `https://api.typesafe.ai/v1` | Jev API |
   | `JEV_MODEL` | `jev-latest` | Jev model |
   | `RAG_TAGGER` | `jev` | `jev` (Gemini fallback) or `gemini` |
   | `RAG_TAG_THRESHOLD` | `0.5` | Minimum Jev probability to keep a tag |
   | `GEMINI_VISION_MODEL` | (empty = `GEMINI_MODEL`) | Model for image transcription |
   | `RAG_INGEST_POLL_MS` | `5000` | Worker poll interval |
   | `RAG_INGEST_WORKER_ENABLED` | `true` | Set `false` to stop picking up jobs |
   | `RAG_MAX_PDF_PAGES` | `300` | PDFs with more pages fail with a clear error. Docling converts at most this + 1 pages, so an over-limit PDF fails fast |
   | `RAG_INGEST_EMBED_BATCH_SIZE` | `1` | Texts per Ollama embedding request while ingesting (sent one after another). Small batches let user queries slip in between |
   | `RAG_QUERY_EMBED_TIMEOUT_MS` | `3000` | Max wait for a retrieval query embedding. Past it, that request uses BM25 only |

6. When the server runs in Docker, mount `RAG_STORAGE_DIR` as a volume. It holds the source PDFs and the images
   that the admin page shows next to image chunks, so it must not live inside the image or the container layer:

   ```
   docker run ... -e RAG_STORAGE_DIR=/data/rag -v rag-storage:/data/rag nutrition-coach-server
   ```

### Verify end to end

Log in as an admin and keep the token:

```
curl -s -X POST localhost:3001/admin/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"<admin email>","password":"<password>"}'
# TOKEN = data.accessToken
```

1. Add a web page and poll until `status` is `ready` and `chunkCount > 0`:

   ```
   curl -s -X POST localhost:3001/admin/rag/documents/url -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"url":"https://www.who.int/news-room/fact-sheets/detail/healthy-diet"}'
   curl -s localhost:3001/admin/rag/documents/<id> -H "Authorization: Bearer $TOKEN"
   ```

2. Upload a PDF with tables and an infographic, then poll it the same way:

   ```
   curl -s -X POST localhost:3001/admin/rag/documents/upload -H "Authorization: Bearer $TOKEN" \
     -F 'file=@guide.pdf;type=application/pdf'
   ```

3. Check the chunks against the PDF. Table rows must match the PDF exactly. Image chunks must carry the numbers
   from the image, and logos must not create chunks:

   ```
   curl -s "localhost:3001/admin/rag/documents/<id>/chunks?blockKind=table" -H "Authorization: Bearer $TOKEN"
   curl -s "localhost:3001/admin/rag/documents/<id>/chunks?blockKind=image" -H "Authorization: Bearer $TOKEN"
   curl -s localhost:3001/admin/rag/chunks/<chunkId>/image -H "Authorization: Bearer $TOKEN" -o image.png
   ```

4. Edit a chunk, then search for a word from the new content without restarting the server:

   ```
   curl -s -X PATCH localhost:3001/admin/rag/chunks/<chunkId> -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"content":"..."}'
   curl -s "localhost:3001/rag/evaluate?q=<word>&mode=bm25-only"
   ```

   Re-ingest the document (`POST /admin/rag/documents/<id>/reingest`): the edited chunk keeps its content.
   Disable a chunk with `{"isActive":false}`: `/rag/evaluate` stops returning it.

5. Restart the server on an empty knowledge base: it must start normally and retrieval returns no results.
