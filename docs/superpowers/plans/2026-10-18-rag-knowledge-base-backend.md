# Kho tài liệu RAG — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây công cụ nạp tài liệu (URL/PDF → Docling → bảng/ảnh → chia đoạn → gắn nhãn Jev → embedding `bge-m3` → `rag_chunks`) chạy bằng job nền, cùng API admin để quản lý và sửa kho, và các sửa đổi tối thiểu để `RetrievalService` dùng được kho mới.

**Architecture:** Module mới `src/rag-ingest/` chứa các khối thuần (taxonomy, table-to-text, chunker, merge planner) và các service (Docling client, image transcriber, taggers, store, pipeline, worker). Module `src/admin/rag-documents/` cung cấp API admin theo mẫu `admin-condition-rules`. Hàng đợi job là bảng Postgres, worker dùng `SchedulerRegistry` chạy từng job một. Ghi DB của công cụ nạp dùng TypeORM `DataSource` (để có transaction). Schema RAG vẫn do `PostgresRagService.ensureSchema` tạo bằng SQL thô.

**Tech Stack:** NestJS 11, TypeORM 0.3 (`DataSource.query`/`transaction`), Postgres + pgvector, Jest + ts-jest, axios, `@nestjs/schedule`, `@nestjs/platform-express` (multer), Ollama `/api/embed`, `docling-serve` (Docker), TypeSafe Jev API, Gemini (qua `LLM_PROVIDER`).

**Spec:** `docs/superpowers/specs/2026-10-18-rag-knowledge-base-design.md`. Người làm đọc cả spec lẫn plan này. Frontend nằm ở plan riêng: `docs/superpowers/plans/2026-10-18-rag-knowledge-base-admin-ui.md`.

## Global Constraints

- Lệnh test: `npm test -- <đường-dẫn-spec>` (Jest, `roots: src`, file `*.spec.ts` đặt cạnh file code).
- Embedding RAG: model `bge-m3`, **1024** chiều, **không bỏ dấu, không lowercase**. Gọi Ollama `POST {OLLAMA_BASE_URL}/api/embed` với body `{ model, input: string[] }`, nhận về `{ embeddings: number[][] }`.
- Embedding food giữ nguyên: model `nomic-embed-text`, chuẩn hóa như cũ, `POSTGRES_VECTOR_DIM` (768) vẫn dành cho `food_embeddings`.
- Gắn nhãn: mặc định Jev, `POST {TYPESAFE_API_URL}/systemone`, header `Authorization: Bearer {TYPESAFE_API_KEY}`, model `jev-latest`. Ngưỡng mặc định `RAG_TAG_THRESHOLD=0.5`.
- Gemini (đọc ảnh, gắn nhãn dự phòng) **đi theo `LLM_PROVIDER` (`platform` | `gemini`)**. Không thêm đường gọi chỉ dùng `GEMINI_API_KEY`.
- **Mỗi lúc chỉ chạy một job.** Embedding lúc nạp gửi theo lô **8** đoạn, lần lượt từng lô. Jev gọi lần lượt từng đoạn.
- PDF: chỉ `application/pdf` và bắt đầu bằng `%PDF-`, tối đa **50MB**, tối đa `RAG_MAX_PDF_PAGES` (mặc định **300**) trang.
- Chia đoạn: mục tiêu **300–800 từ** mỗi đoạn.
- Ảnh nhỏ hơn **120px** ở một chiều thì bỏ qua.
- Domain hợp lệ: `guidelines`, `conditions`, `safety`. Nhãn chỉ được lấy từ `RAG_TAXONOMY`.
- Mọi chữ lưu vào kho đều được chuẩn hóa Unicode **NFC**.
- Đường dẫn API admin bắt đầu bằng `/admin/rag/`, dùng `@UseFilters(AdminAuthExceptionFilter)` và `@UseGuards(AdminJwtAuthGuard, AdminRoleGuard)`. Response thành công là `{ success: true, data, ... }`, lỗi là `{ success: false, error: { code, message } }` (mẫu `AdminFoodException`).
- Thông báo lỗi và cảnh báo của job viết bằng **tiếng Anh**, vì giao diện Admin-page bằng tiếng Anh.
- Không commit `.env`. Biến mới thêm vào `.env.example` ngay trong task tạo ra nó.

## Review Focus

1. **Index đang được dựng lại trong lúc người dùng tìm kiếm.** Hiện `rebuildIndex()` đặt `isIndexReady=false`, nên `retrieve()` trả về `[]` trong lúc dựng lại. Người dùng mong vẫn nhận kết quả từ index cũ cho tới khi index mới sẵn sàng. Test nằm ở Task 3.
2. **Admin sửa một đoạn trong lúc job nạp lại tài liệu đó đang chạy.** Bản sửa phải còn nguyên sau khi job xong. Kế hoạch ghép đoạn phải tính **bên trong transaction ghi**, dựa trên cờ `is_manually_edited` lúc ghi, không phải lúc job bắt đầu. Test nằm ở Task 10.
3. **Xóa tài liệu trong lúc job của nó đang chạy.** Job không được tạo lại các đoạn hay thư mục ảnh của tài liệu đã xóa, và kết thúc không báo lỗi. Test nằm ở Task 11.
4. **Chữ tiếng Việt lấy từ PDF ở dạng Unicode tách dấu (NFD)**, ví dụ "tiểu" gồm ký tự gốc cộng dấu rời. Phải lưu dạng NFC để khớp với truy vấn. Test nằm ở Task 6.
5. **Cùng một URL dán vào với khác biệt nhỏ** (`/` ở cuối, `#hash`, tham số `utm_*`, chữ hoa trong tên miền). Phải nhận ra là trùng và trả về tài liệu đang có. Test nằm ở Task 12.

---

## Cấu trúc file

```
src/rag-ingest/
  rag-taxonomy.ts                 # nguồn sự thật cho nhãn + sanitize + ánh xạ dị ứng
  rag-ingest.types.ts             # ExtractedDocument, DraftChunk, TagResult, ...
  text-normalize.ts               # NFC, đếm từ, detectLanguage
  table-to-text.ts                # bảng → câu (thuần)
  chunker.ts                      # ExtractedDocument → DraftChunk[] (thuần)
  chunk-merge-planner.ts          # kế hoạch ghép đoạn khi nạp lại (thuần)
  url-normalize.ts                # chuẩn hóa URL để chống trùng
  rag-file-storage.service.ts     # lưu/đọc/xóa file dưới RAG_STORAGE_DIR
  docling.client.ts               # gọi docling-serve, map sang ExtractedDocument
  image-transcriber.service.ts    # lọc ảnh + Gemini chép nội dung ảnh
  taggers/jev-tagger.ts
  taggers/gemini-tagger.ts
  taggers/tagging.service.ts      # chọn tagger, tự chuyển sang Gemini
  rag-store.service.ts            # SQL: documents, jobs, chunks, embeddings
  rag-ingest.pipeline.ts          # chạy một job từ đầu đến cuối
  rag-ingest.worker.ts            # nhận job theo chu kỳ, khôi phục khi khởi động
  constants/rag-ingest-prompts.ts
  rag-ingest.module.ts
src/admin/rag-documents/
  admin-rag-documents.controller.ts
  admin-rag-documents.service.ts
  admin-rag-documents.exception.ts
  dto/*.ts
src/ollama/gemini-vision.client.ts  # tách từ AiIngredientVisionService
scripts/sql/rag-reset-embeddings-1024.sql
docker-compose.rag.yml
```

Sửa: `src/retrieval/{postgres-rag.service.ts, vector.service.ts, retrieval.service.ts}`, `src/recipe-builder/{food-semantic-search.service.ts, ai-ingredient-vision.service.ts}`, `src/ollama/ollama.module.ts`, `src/admin/admin.module.ts`, `src/app.module.ts`, `.env.example`, `README.md`.

---

### Task 1: Taxonomy nhãn

**Files:**
- Create: `src/rag-ingest/rag-taxonomy.ts`
- Test: `src/rag-ingest/rag-taxonomy.spec.ts`

**Interfaces:**
- Produces:
  - `type RagTagGroup = "conditions" | "allergens" | "goals" | "nutrients"`
  - `type RagDomain = "guidelines" | "conditions" | "safety"`
  - `type RagTags = Record<RagTagGroup, string[]>`
  - `type RagTaxonomyItem = { key: string; labelEn: string; labelVi: string; description: string }`
  - `const RAG_DOMAINS: RagTaxonomyItem[]`, `const RAG_TAXONOMY: Record<RagTagGroup, RagTaxonomyItem[]>`
  - `emptyTags(): RagTags`
  - `sanitizeTags(input: unknown): { tags: RagTags; invalid: string[] }`: bỏ giá trị không có trong taxonomy và trả lại danh sách bị bỏ dạng `"group:key"`. Kết quả không trùng, giữ thứ tự của taxonomy.
  - `isRagDomain(value: unknown): value is RagDomain`
  - `allergyLabelToKey(label: string): string | null`

- [ ] **Step 1: Viết test lỗi**

```ts
describe("rag-taxonomy", () => {
  it("has the exact keys from the onboarding lists", () => {
    expect(RAG_TAXONOMY.conditions.map((t) => t.key)).toEqual(
      ["hypertension", "diabetes", "heart_disease", "kidney_disease", "thyroid", "high_cholesterol"]);
    expect(RAG_TAXONOMY.goals.map((t) => t.key)).toEqual(
      ["weight_loss", "maintenance", "weight_gain", "muscle_gain", "modify_diet", "plan_meals", "manage_stress", "stay_active"]);
    expect(RAG_TAXONOMY.allergens.map((t) => t.key)).toEqual(
      ["peanuts", "tree_nuts", "milk_lactose", "eggs", "fish", "shellfish", "soy", "wheat_gluten", "sesame"]);
    expect(RAG_TAXONOMY.nutrients.map((t) => t.key)).toEqual(expect.arrayContaining(
      ["sodium", "sugar", "fiber", "saturated_fat", "cholesterol", "potassium", "protein", "carbs", "calories"]));
    expect(RAG_DOMAINS.map((d) => d.key)).toEqual(["guidelines", "conditions", "safety"]);
  });
  it("every item has labelEn, labelVi and an English description", () => { /* duyệt mọi item: 3 trường không rỗng */ });
  it("sanitizeTags drops unknown values and duplicates", () => {
    expect(sanitizeTags({ conditions: ["diabetes", "tiểu đường", "diabetes"], allergens: ["shellfish"], goals: "x" }))
      .toEqual({ tags: { conditions: ["diabetes"], allergens: ["shellfish"], goals: [], nutrients: [] },
                 invalid: ["conditions:tiểu đường"] });
  });
  it("maps onboarding allergy labels to keys", () => {
    expect(allergyLabelToKey("Wheat or gluten")).toBe("wheat_gluten");
    expect(allergyLabelToKey("milk or lactose")).toBe("milk_lactose");
    expect(allergyLabelToKey("Durian")).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, thấy lỗi** — `npm test -- src/rag-ingest/rag-taxonomy.spec.ts`. Mong đợi: FAIL (không tìm thấy module).
- [ ] **Step 3: Viết code `rag-taxonomy.ts`.** `labelVi` do người làm điền, ví dụ `hypertension` → "Tăng huyết áp". `description` là câu hỏi tiếng Anh dùng cho Jev, dạng "Does this passage give dietary advice relevant to people with high blood pressure (hypertension)?". Với dị ứng: "Does this passage mention or warn about a peanut allergy or foods containing peanuts?". Danh sách nutrients tối thiểu gồm 9 key ở test. Người làm đối chiếu thêm với giá trị thực của `UserNutritionalThreshold.Nutrient` và condition rules trong DB, rồi ghi chú nguồn trong comment. Thêm một comment ghi rằng danh sách lấy theo `calorie-counter-web/src/features/onboarding/mapping.ts` và chưa đối chiếu với app Flutter.
- [ ] **Step 4: Chạy test, thấy pass.**
- [ ] **Step 5: Commit** (kèm luôn spec và plan nếu chưa commit)

```bash
git add src/rag-ingest/rag-taxonomy.ts src/rag-ingest/rag-taxonomy.spec.ts docs/superpowers
git commit -m "feat(rag-ingest): add RAG tag taxonomy"
```

---

### Task 2: Schema kho mới trong `PostgresRagService`

**Files:**
- Modify: `src/retrieval/postgres-rag.service.ts`
- Create: `scripts/sql/rag-reset-embeddings-1024.sql`
- Test: `src/retrieval/postgres-rag.service.spec.ts`

**Interfaces:**
- Produces (bảng/cột mà các task sau dùng; tên SQL chính xác):
  - `rag_documents(id text PK, source_type text, source_url text NULL, original_filename text NULL, file_path text NULL, file_hash text NULL, title text, language text NULL, status text, chunk_count int DEFAULT 0, created_by bigint NULL, created_at, updated_at)`. Unique index một phần trên `source_url` (khi không null) và trên `file_hash` (khi `source_type='pdf'`).
  - `rag_ingest_jobs(id bigserial PK, document_id text REFERENCES rag_documents(id) ON DELETE CASCADE, status text, stage text NULL, progress int DEFAULT 0, error_message text NULL, warnings jsonb DEFAULT '[]', attempt int DEFAULT 1, started_at, finished_at, created_at)`. Index trên `(status, created_at)`.
  - Cột mới của `rag_chunks` (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`): `chunk_key text, heading_path text, page_from int, page_to int, block_kind text DEFAULT 'text', image_path text, language text, domain text, tags jsonb DEFAULT '{}', tag_scores jsonb DEFAULT '{}', is_active boolean DEFAULT true, is_manually_edited boolean DEFAULT false, needs_review boolean DEFAULT false, source_content_hash text`. Thêm FK `doc_id → rag_documents(id) ON DELETE CASCADE` bằng `DO $$ … IF NOT EXISTS … $$`.
  - `rag_embeddings.embedding vector(RAG_EMBEDDING_DIM)`. Số chiều đọc từ `RAG_EMBEDDING_DIM` (mặc định `1024`), không dùng `POSTGRES_VECTOR_DIM` nữa. Model mặc định đọc từ `RAG_EMBEDDING_MODEL` (`bge-m3`).
  - `PostgresRagService.checkEmbeddingDimension(): Promise<{ ok: boolean; actual: number | null; expected: number }>`: đọc `atttypmod` của `rag_embeddings.embedding` từ `pg_attribute`. `ensureSchema` gọi nó, và `console.error` một thông báo hướng dẫn chạy script reset nếu số chiều lệch.
  - `loadChunks()` chỉ lấy `is_active = true`, join `rag_documents` để lấy `source_url`, và trả `DomainDoc` với:
    - `title` = `heading_path ? \`${title} › ${heading_path}\` : title`
    - `metadata.domain` = cột `domain` (nếu null thì dùng `metadata.domain` cũ)
    - `metadata.tags`, `metadata.heading_path`, `metadata.page_from`, `metadata.block_kind`
    - `metadata.link` = `source_url`
  - `loadCorpus()` trả `{ docs: [] }` khi kho trống, không throw.

- [ ] **Step 1: Viết test lỗi** (theo kiểu mock `pg` có sẵn trong file spec):

```ts
it("ensureSchema creates rag_documents, rag_ingest_jobs and new chunk columns", async () => {
  queryMock.mockResolvedValue({ rows: [{ atttypmod: 1024 }], rowCount: 1 });
  await new PostgresRagService(createConfig(true)).ensureSchema();
  const sql = queryMock.mock.calls.map((c) => String(c[0])).join("\n");
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."rag_documents"/);
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."rag_ingest_jobs"/);
  expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS is_manually_edited boolean/);
  expect(sql).toMatch(/vector\(1024\)/);
});
it("checkEmbeddingDimension reports mismatch", async () => {
  queryMock.mockResolvedValue({ rows: [{ atttypmod: 768 }], rowCount: 1 });
  await expect(new PostgresRagService(createConfig(true)).checkEmbeddingDimension())
    .resolves.toEqual({ ok: false, actual: 768, expected: 1024 });
});
it("loadCorpus maps active chunks with tags, heading title and link", async () => {
  queryMock.mockResolvedValueOnce({ rows: [{ id: "d1-k1", doc_id: "d1", source: "who.int", title: "Healthy diet",
    heading_path: "Salt", content: "Keep salt < 5 g", metadata: {}, domain: "guidelines",
    tags: { nutrients: ["sodium"] }, page_from: null, block_kind: "text", source_url: "https://who.int/x" }] });
  const { docs } = await service.loadCorpus();
  expect(docs[0]).toMatchObject({ id: "d1-k1", title: "Healthy diet › Salt",
    metadata: { domain: "guidelines", tags: { nutrients: ["sodium"] }, link: "https://who.int/x" } });
  expect(String(queryMock.mock.calls.at(-1)![0])).toMatch(/is_active = true/);
});
```

Sửa `createConfig` trong spec để có `RAG_EMBEDDING_DIM: "1024"`.

- [ ] **Step 2: Chạy test, thấy lỗi** — `npm test -- src/retrieval/postgres-rag.service.spec.ts`.
- [ ] **Step 3: Viết code** theo khối Interfaces. Tất cả DDL phải chạy lại được nhiều lần (`IF NOT EXISTS`).
- [ ] **Step 4: Viết `scripts/sql/rag-reset-embeddings-1024.sql`**: `DROP TABLE IF EXISTS public.rag_embeddings;`, kèm comment ghi rằng server sẽ tạo lại bảng với `vector(1024)` lúc khởi động, và kho cũ đã mất nên không có dữ liệu cần giữ.
- [ ] **Step 5: Chạy test, thấy pass.** Chạy thêm cả `npm test -- src/retrieval` để chắc các test cũ không hỏng.
- [ ] **Step 6: Thêm vào `.env.example`:** `RAG_EMBEDDING_MODEL=bge-m3`, `RAG_EMBEDDING_DIM=1024`.
- [ ] **Step 7: Commit** — `git commit -m "feat(rag): schema for rag_documents, ingest jobs and chunk tags"`

---

### Task 3: `VectorService` / `RetrievalService` dùng được kho mới

**Files:**
- Modify: `src/retrieval/vector.service.ts`, `src/retrieval/retrieval.service.ts`, `src/recipe-builder/food-semantic-search.service.ts`
- Test: `src/retrieval/vector.service.spec.ts`, `src/retrieval/retrieval.service.spec.ts`, `src/recipe-builder/food-semantic-search.service.spec.ts`

**Interfaces:**
- Consumes: `PostgresRagService.loadCorpus()` (Task 2).
- Produces:
  - `VectorService.getQueryEmbedding(query: string): Promise<number[]>`: model RAG (`RAG_EMBEDDING_MODEL`), giữ nguyên text (chỉ `trim` và NFC), gọi `/api/embed`.
  - `VectorService.embedDocuments(texts: string[]): Promise<number[][]>`: model RAG, chia lô 8 và gọi lần lượt từng lô, trả về theo đúng thứ tự đầu vào.
  - `VectorService.getFoodQueryEmbedding(query: string): Promise<number[]>`: model `FOOD_EMBEDDING_MODEL` (mặc định `nomic-embed-text`), giữ `normalizeForEmbedding` và endpoint `/api/embeddings` như cũ.
  - `RetrievalService.scheduleRebuild(): void`: gộp các lần gọi trong 2000ms thành một lần `rebuildIndex()`.
  - `RetrievalService.rebuildIndex(): Promise<void>`: dựng `Bm25Searcher` và danh sách docs **mới** vào biến cục bộ, xong rồi mới thay vào chỗ cũ. Trong lúc dựng, `retrieve()` vẫn dùng index cũ.

- [ ] **Step 1: Viết test lỗi**

```ts
// vector.service.spec.ts
it("getQueryEmbedding keeps Vietnamese diacritics and uses the RAG model", async () => {
  fetchMock.mockResolvedValue(okJson({ embeddings: [[0.1, 0.2]] }));
  await service.getQueryEmbedding("Người tiểu đường");
  expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/embed$/),
    expect.objectContaining({ body: JSON.stringify({ model: "bge-m3", input: ["Người tiểu đường"] }) }));
});
it("embedDocuments batches by 8 sequentially and preserves order", async () => {
  // 10 texts → 2 lần gọi (8 + 2), kết quả trả về đúng thứ tự 10 vector
});
it("getFoodQueryEmbedding keeps the old normalization and model", async () => {
  // body chứa model "nomic-embed-text" và prompt "nguoi tieu duong"
});

// retrieval.service.spec.ts
it("starts with an empty corpus without throwing and retrieve returns []", async () => { /* loadCorpus → { docs: [] } */ });
it("serves results from the old index while rebuildIndex is running", async () => {
  // corpus ban đầu có 1 doc; loadCorpus lần 2 trả về một promise mình tự điều khiển (chưa resolve)
  // gọi rebuildIndex() (không await), gọi retrieve("salt", 5, {}, "bm25-only") → vẫn trả doc cũ
  // resolve corpus mới → sau khi rebuild xong, retrieve trả doc mới
});
it("scheduleRebuild debounces multiple calls into one rebuild", async () => {
  // jest.useFakeTimers(); gọi scheduleRebuild 3 lần; advanceTimersByTime(2000) → loadCorpus được gọi đúng 1 lần
});
```

Trong `food-semantic-search.service.spec.ts`, đổi mock `getQueryEmbedding` thành `getFoodQueryEmbedding` và assert nó được gọi.

- [ ] **Step 2: Chạy test, thấy lỗi** — `npm test -- src/retrieval src/recipe-builder/food-semantic-search.service.spec.ts`.
- [ ] **Step 3: Viết code.**
  - `VectorService`: bỏ `model` và `embeddingDim` gán cứng, đọc từ config. Nhánh cache đĩa (legacy, khi không bật pgvector) giữ nguyên nhưng dùng model RAG.
  - `RetrievalService.onModuleInit`: `POSTGRES_SYNC_EMBEDDINGS_ON_BOOT` mặc định `"false"`.
  - `loadDomainData()`: kho trống chỉ `console.warn`, không throw. Tách thành hàm trả về docs thay vì gán thẳng vào `this.docs`.
  - Bỏ `this.isIndexReady = false` trong `rebuildIndex`.
  - `FoodSemanticSearchService`: gọi `getFoodQueryEmbedding` ở cả `searchIngredient` lẫn `batchSearchIngredients`.
- [ ] **Step 4: Chạy test, thấy pass** (cả thư mục `src/retrieval` và `src/recipe-builder`).
- [ ] **Step 5: `.env.example`:** thêm `FOOD_EMBEDDING_MODEL=nomic-embed-text`, đổi `POSTGRES_SYNC_EMBEDDINGS_ON_BOOT=false`.
- [ ] **Step 6: Commit** — `git commit -m "feat(retrieval): bge-m3 for RAG, hot index rebuild, empty corpus"`

---

### Task 4: Tách `GeminiVisionClient` dùng chung

**Files:**
- Create: `src/ollama/gemini-vision.client.ts`
- Modify: `src/ollama/ollama.module.ts` (provide + export), `src/recipe-builder/ai-ingredient-vision.service.ts`
- Test: `src/ollama/gemini-vision.client.spec.ts`, `src/recipe-builder/ai-ingredient-vision.service.spec.ts` (đang có, phải tiếp tục pass)

**Interfaces:**
- Produces:
  - `type InlineImage = { base64: string; mimeType: string }`
  - `GeminiVisionClient.generateWithImage(prompt: string, image: InlineImage): Promise<string>`: trả về text đã nối từ `candidates[].content.parts[].text`. Dùng `responseMimeType: "application/json"` và `temperature: 0.1`. Chọn nhánh `platform` hay `gemini` theo `LLM_PROVIDER`, model từ `GEMINI_VISION_MODEL || GEMINI_MODEL` qua `resolveGeminiModel`. Ở nhánh platform, khi gặp lỗi "Invalid JSON payload…" thì thử lại một lần ở dạng `multiline`. Lỗi thì throw `Error` (không throw `BadRequestException`).
- `AiIngredientVisionService.recognizeIngredients` giữ nguyên hành vi bên ngoài (vẫn ném `BadRequestException("Could not recognize ingredients from this image.")`), bên trong gọi `GeminiVisionClient`.

- [ ] **Step 1: Viết test lỗi** cho client: (a) với `LLM_PROVIDER=gemini`, request đi tới `…/models/<model>:generateContent`, có header `x-goog-api-key`, và body có `inline_data`; (b) với `platform`, request đi tới `${AI_API_URL}/api` với `{ appName, data }`, trong đó `data` là chuỗi đã mã hóa (mock `PlatformCryptoService.encrypt`); (c) platform trả lỗi "Invalid JSON payload received… Root element must be a message" thì client gọi lại đúng 1 lần; (d) response rỗng thì throw `"Gemini returned empty response"`.
- [ ] **Step 2: Chạy test, thấy lỗi** — `npm test -- src/ollama/gemini-vision.client.spec.ts`.
- [ ] **Step 3: Chuyển code.** Dời `generateViaGemini`, `generateViaPlatform`, `buildGeminiBody`, `buildGeminiCurlCommand`, các hàm quote, `extractText`, `isGeminiInvalidJsonPayload` và `resolveLlmProvider` từ `AiIngredientVisionService` sang client. Service chỉ còn tải ảnh, gọi client và parse kết quả.
- [ ] **Step 4: Chạy test, thấy pass** — `npm test -- src/ollama src/recipe-builder/ai-ingredient-vision.service.spec.ts`. Sửa mock trong spec cũ nếu cần, nhưng **không đổi các assertion về hành vi**.
- [ ] **Step 5: Commit** — `git commit -m "refactor(ollama): share Gemini image request client"`

---

### Task 5: Kiểu dữ liệu nạp, chuẩn hóa chữ, bảng → câu

**Files:**
- Create: `src/rag-ingest/rag-ingest.types.ts`, `src/rag-ingest/text-normalize.ts`, `src/rag-ingest/table-to-text.ts`
- Test: `src/rag-ingest/text-normalize.spec.ts`, `src/rag-ingest/table-to-text.spec.ts`

**Interfaces:**
- Produces (`rag-ingest.types.ts`):

```ts
export type BlockKind = "text" | "table" | "image";
export type ExtractedBlock =
  | { kind: "heading"; level: number; text: string; page?: number }
  | { kind: "paragraph"; text: string; page?: number }
  | { kind: "table"; caption?: string; header: string[][]; rows: string[][]; page?: number }
  | { kind: "image"; caption?: string; contextText?: string; page?: number;
      image: { base64: string; mimeType: string; width: number; height: number } };
export type ExtractedDocument = { title: string; pageCount?: number; blocks: ExtractedBlock[] };
export type DraftChunk = {
  chunkKey: string; headingPath: string; pageFrom: number | null; pageTo: number | null;
  blockKind: BlockKind; content: string; language: "en" | "vi";
  imageBlockIndex?: number;        // vị trí block ảnh trong ExtractedDocument.blocks
  sourceContentHash: string;       // sha256 của content
};
```

- `text-normalize.ts`: `normalizeText(s: string): string` (NFC, gộp khoảng trắng, trim), `countWords(s: string): number`, `detectLanguage(s: string): "en" | "vi"` ("vi" khi tỉ lệ ký tự đặc trưng tiếng Việt (`ăâđêôơư` và các nguyên âm có dấu thanh) trên tổng số chữ cái ≥ 0.05, tính sau NFC), `documentLanguage(chunks: { language: "en" | "vi"; content: string }[]): "en" | "vi" | "mixed"` (tính theo số từ, "mixed" khi ngôn ngữ thiểu số chiếm ≥ 30%).
- `table-to-text.ts`: `tableToTexts(table: Extract<ExtractedBlock, { kind: "table" }>, maxWords: number): string[]`.

- [ ] **Step 1: Viết test lỗi**

```ts
it("normalizeText converts NFD Vietnamese to NFC", () => {
  expect(normalizeText("tiẻu  đường ")).toBe("tiểu đường");
});
it("detectLanguage", () => {
  expect(detectLanguage("Người bệnh tiểu đường nên hạn chế đường")).toBe("vi");
  expect(detectLanguage("Keep salt intake below 5 g per day")).toBe("en");
});
it("documentLanguage returns mixed when the minority language has ≥30% of words", () => { /* 70/30 → mixed; 90/10 → majority */ });

it("turns each row into a sentence with caption and column names", () => {
  const out = tableToTexts({ kind: "table", caption: "Bảng 5 – Nhu cầu năng lượng",
    header: [["Nhóm", "Lao động", "Năng lượng (kcal/ngày)"]],
    rows: [["Nam 19–30", "vừa", "2.500"]] }, 800);
  expect(out).toEqual(["Bảng 5 – Nhu cầu năng lượng. Nhóm: Nam 19–30; Lao động: vừa; Năng lượng (kcal/ngày): 2.500"]);
});
it("joins multi-level headers with ' › '", () => {
  // header [["Vitamin", "Vitamin"], ["A (µg)", "C (mg)"]] → tên cột "Vitamin › A (µg)", "Vitamin › C (mg)"
});
it("skips empty rows and repeated header rows (page breaks)", () => {
  // rows chứa ["", "", ""] và một dòng trùng header → không tạo câu cho 2 dòng đó
});
it("drops empty cells from the sentence but keeps numbers exactly as written", () => {
  // ô "" bị bỏ; "2.500", "60–70" giữ nguyên ký tự
});
it("splits long tables into several texts, each repeating the caption", () => {
  // 200 dòng, maxWords 100 → nhiều phần tử, phần tử nào cũng bắt đầu bằng caption
});
```

- [ ] **Step 2: Chạy test, thấy lỗi** — `npm test -- src/rag-ingest/text-normalize.spec.ts src/rag-ingest/table-to-text.spec.ts`.
- [ ] **Step 3: Viết code.** Mỗi phần tử trả về của `tableToTexts` là caption, dấu chấm, rồi các câu-dòng nối bằng `\n`. Thêm dòng vào phần tử hiện tại cho tới khi vượt `maxWords`. Bảng không có caption thì không có tiền tố.
- [ ] **Step 4: Chạy test, thấy pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(rag-ingest): extraction types, text normalization, table to text"`

---

### Task 6: Chunker

**Files:**
- Create: `src/rag-ingest/chunker.ts`
- Test: `src/rag-ingest/chunker.spec.ts`

**Interfaces:**
- Consumes: các kiểu, `normalizeText`, `countWords`, `detectLanguage` và `tableToTexts` từ Task 5.
- Produces:
  - `const CHUNK_MIN_WORDS = 300`, `const CHUNK_MAX_WORDS = 800`
  - `chunkDocument(doc: ExtractedDocument, imageTexts: Map<number, string>): DraftChunk[]`. `imageTexts` có key là chỉ số block ảnh và value là nội dung Gemini chép ra. Block ảnh không có trong map thì bị bỏ.
  - `buildEmbeddingText(docTitle: string, chunk: { headingPath: string; content: string }): string` = `[docTitle, headingPath, content]` (bỏ phần rỗng) nối bằng `"\n"`.
- Quy tắc (chính là những gì test cố định):
  - `headingPath` = các tiêu đề đang mở theo `level`, nối bằng `" › "`.
  - Đoạn văn trong cùng một mục được gộp thành đoạn `text`. Vượt `CHUNK_MAX_WORDS` thì cắt ở ranh giới đoạn văn. Một đoạn văn dài hơn max (ví dụ trang web không có tiêu đề) thì cắt theo câu.
  - Đoạn `text` ngắn hơn `CHUNK_MIN_WORDS` được gộp với đoạn `text` kế tiếp **có cùng tiêu đề cha** nếu tổng ≤ max. `headingPath` của đoạn gộp là đường dẫn của tiêu đề cha chung.
  - Mỗi phần tử của `tableToTexts(…, CHUNK_MAX_WORDS)` là một đoạn `table`. Mỗi ảnh có trong map là một đoạn `image` (content = nội dung đã chép, thêm `caption` ở đầu nếu có).
  - `chunkKey` = 16 ký tự hex đầu của `sha1(headingPath + "|" + blockKind + "|" + ordinal)`, trong đó `ordinal` là số thứ tự của đoạn cùng `headingPath` và `blockKind`.
  - `content` luôn qua `normalizeText`. `language` = `detectLanguage(content)`. `pageFrom` và `pageTo` lấy từ các block góp vào đoạn.

- [ ] **Step 1: Viết test lỗi**: (a) hai mục `h2` dưới cùng một `h1`, mỗi mục khoảng 100 từ → gộp thành 1 đoạn có `headingPath = "H1"`; (b) một mục 2000 từ có nhiều đoạn văn → ≥3 đoạn, đoạn nào cũng ≤ 800 từ; (c) một đoạn văn 1700 từ không có tiêu đề → cắt theo câu, đoạn nào cũng ≤ 800 từ; (d) bảng và ảnh tách thành đoạn riêng với đúng `blockKind`, ảnh không có trong `imageTexts` thì không tạo đoạn; (e) **chạy 2 lần trên cùng đầu vào thì ra cùng `chunkKey`**, và sửa một đoạn văn trong mục B không làm đổi `chunkKey` của mục A; (f) nội dung NFD đầu vào → `content` ở dạng NFC; (g) `pageFrom`/`pageTo` của đoạn trải qua 2 trang là `3`/`4`; (h) `buildEmbeddingText("Healthy diet", { headingPath: "Salt", content: "x" }) === "Healthy diet\nSalt\nx"`.
- [ ] **Step 2: Chạy test, thấy lỗi** — `npm test -- src/rag-ingest/chunker.spec.ts`.
- [ ] **Step 3: Viết code `chunker.ts`.**
- [ ] **Step 4: Chạy test, thấy pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(rag-ingest): structure-aware chunker"`

---

### Task 7: Docling client

**Files:**
- Create: `src/rag-ingest/docling.client.ts`, `src/rag-ingest/__fixtures__/docling-pdf-response.json`, `src/rag-ingest/__fixtures__/docling-html-response.json`
- Test: `src/rag-ingest/docling.client.spec.ts`

**Interfaces:**
- Consumes: `ExtractedDocument` (Task 5), `normalizeText`.
- Produces:
  - `DoclingClient.convertUrl(url: string): Promise<ExtractedDocument>`
  - `DoclingClient.convertPdf(buffer: Buffer, filename: string): Promise<ExtractedDocument>`
  - `mapDoclingDocument(json: unknown): ExtractedDocument`: hàm thuần, export để test.
  - `class DoclingError extends Error { code: "FETCH_FAILED" | "CONVERT_FAILED" | "UNAVAILABLE" }`
- Gọi `docling-serve` ở `DOCLING_URL`, tắt OCR, bật trích ảnh dạng embedded (base64), đầu ra là JSON `DoclingDocument`. Duyệt `body.children` theo thứ tự:
  - Bỏ các label `page_header`, `page_footer` (furniture).
  - `title` và `section_header` → `heading` (`level` lấy từ docling, `title` có level 1).
  - `text`, `list_item`, `paragraph` → `paragraph`.
  - `tables` → `table` (dựng `header` và `rows` từ `data.grid`, ô tiêu đề cột là các ô có `column_header=true`).
  - `pictures` → `image` (base64 lấy từ data URI `image.uri`, kích thước từ `image.size`, `caption` từ các ref `captions`, `contextText` là tối đa 300 ký tự của các đoạn văn liền trước).
  - `page` lấy từ `prov[0].page_no`. `ExtractedDocument.title` = text của block `title` đầu tiên, không có thì lấy tên file hoặc URL.
- Timeout 10 phút cho PDF, 2 phút cho URL. Lỗi kết nối → `UNAVAILABLE`. Docling báo lỗi tải URL → `FETCH_FAILED`. Các lỗi khác → `CONVERT_FAILED`.

- [ ] **Step 1: Chọn và ghim phiên bản** image `docling-serve` (bản CPU). Chạy local, gọi thật một lần với một PDF nhỏ có bảng và ảnh, và một lần với một trang web. Lưu response (cắt bớt base64 cho nhẹ) vào 2 file fixture. Ghi lại endpoint và các tùy chọn đã dùng vào comment đầu file `docling.client.ts`.
- [ ] **Step 2: Viết test lỗi** cho `mapDoclingDocument` dựa trên fixture: thứ tự block đúng như trong tài liệu, không còn header/footer, bảng có đúng số dòng và cột, ảnh có `base64`/`width`/`height`/`caption`, tiêu đề lấy đúng. Thêm test cho `convertUrl` với axios bị mock: kết nối bị từ chối → `DoclingError("UNAVAILABLE")`.
- [ ] **Step 3: Chạy test, thấy lỗi** — `npm test -- src/rag-ingest/docling.client.spec.ts`.
- [ ] **Step 4: Viết code.**
- [ ] **Step 5: Chạy test, thấy pass.**
- [ ] **Step 6: Thêm `docker-compose.rag.yml`** với service `docling` (image đã ghim ở Step 1, `ports: 5001:5001`, `mem_limit: 4g`, 1 worker theo biến môi trường của docling-serve, tắt OCR mặc định nếu image hỗ trợ). Thêm `DOCLING_URL=http://localhost:5001` vào `.env.example`.
- [ ] **Step 7: Commit** — `git commit -m "feat(rag-ingest): docling-serve client and compose service"`

---

### Task 8: Đọc ảnh bằng Gemini

**Files:**
- Create: `src/rag-ingest/image-transcriber.service.ts`, `src/rag-ingest/constants/rag-ingest-prompts.ts`
- Test: `src/rag-ingest/image-transcriber.service.spec.ts`

**Interfaces:**
- Consumes: `GeminiVisionClient.generateWithImage` (Task 4), block `image` (Task 5).
- Produces:
  - `const MIN_IMAGE_SIDE_PX = 120`
  - `selectImagesToTranscribe(blocks: ExtractedBlock[]): number[]`: chỉ số các block ảnh cần gửi đi. Bỏ ảnh có cạnh < 120px, và bỏ ảnh có cùng sha256 xuất hiện trên ≥ 2 trang khác nhau (logo).
  - `ImageTranscriberService.transcribeAll(blocks: ExtractedBlock[], onProgress?: (done: number, total: number) => void): Promise<{ texts: Map<number, string>; skippedErrors: number }>`. Gọi lần lượt từng ảnh, không song song. Mỗi ảnh được thử lại tối đa 2 lần, vẫn lỗi thì tăng `skippedErrors` rồi bỏ qua ảnh đó. `has_information=false` thì không đưa vào map.
  - `RAG_INGEST_PROMPTS.IMAGE_TRANSCRIBE(caption?: string, context?: string): string`: yêu cầu trả về JSON `{ "has_information": boolean, "transcription": string }`. Chép **nguyên văn** chữ và số, giữ quan hệ nhãn–số (ví dụ "Tầng 2 – Rau củ: 300–400 g/ngày"), **không suy đoán, không thêm số**, giữ ngôn ngữ gốc. Ảnh trang trí, ảnh món ăn, logo hay ảnh không có chữ thì trả `has_information=false`.

- [ ] **Step 1: Viết test lỗi**: (a) ảnh 100×400 và ảnh logo lặp ở trang 1, 2 bị loại khỏi `selectImagesToTranscribe`; (b) client trả `{"has_information":true,"transcription":"Muối: < 5 g"}` → map có `"Muối: < 5 g"`; (c) `has_information:false` → không có trong map; (d) client throw 3 lần → `skippedErrors === 1`, xử lý tiếp ảnh sau; (e) JSON hỏng → coi như lỗi của ảnh đó; (f) các lời gọi diễn ra tuần tự (lời gọi thứ hai chỉ bắt đầu sau khi lời gọi thứ nhất resolve).
- [ ] **Step 2: Chạy test, thấy lỗi** — `npm test -- src/rag-ingest/image-transcriber.service.spec.ts`.
- [ ] **Step 3: Viết code.**
- [ ] **Step 4: Chạy test, thấy pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(rag-ingest): Gemini image transcription"`

---

### Task 9: Taggers (Jev, Gemini, tự chuyển)

**Files:**
- Create: `src/rag-ingest/taggers/jev-tagger.ts`, `src/rag-ingest/taggers/gemini-tagger.ts`, `src/rag-ingest/taggers/tagging.service.ts`
- Test: `src/rag-ingest/taggers/*.spec.ts`

**Interfaces:**
- Consumes: `RAG_TAXONOMY`, `RAG_DOMAINS`, `sanitizeTags`, `isRagDomain` (Task 1), `OllamaService.chat` (có sẵn).
- Produces:
  - `type TagResult = { domain: RagDomain; tags: RagTags; scores: Record<string, number>; tagger: "jev" | "gemini" }`. Key của `scores` có dạng `"domain:<key>"` hoặc `"<group>:<key>"`.
  - `interface RagTagger { readonly name: "jev" | "gemini"; tag(text: string): Promise<TagResult> }`
  - `JevTagger`:
    - Một request cho mỗi đoạn, `state` = text (cắt còn 6000 ký tự), `model` = `JEV_MODEL`.
    - Câu hỏi `domain` là `choice` với `criteria` lấy từ `RAG_DOMAINS` (key → description). Mỗi nhãn là một câu hỏi `noul` với id `"<group>__<key>"` và `instructions` = `description`.
    - Giữ những nhãn có `noul ≥ RAG_TAG_THRESHOLD`.
    - Thử lại tối đa 3 lần với backoff 1s, 2s, 4s khi gặp 429, 5xx hoặc lỗi mạng. Lỗi 4xx khác thì throw ngay.
  - `GeminiTagger`: gọi `OllamaService.chat` với prompt yêu cầu JSON `{domain, conditions[], allergens[], goals[], nutrients[]}` và liệt kê các key hợp lệ. Kết quả đưa qua `sanitizeTags`. Domain không hợp lệ → `"guidelines"`. `scores` = 1 cho các giá trị được chọn.
  - `TaggingService.tagAll(texts: string[], onProgress?: (done: number, total: number) => void): Promise<{ results: (TagResult | null)[]; warnings: string[] }>`:
    - `RAG_TAGGER=gemini` thì chỉ dùng Gemini.
    - Mặc định dùng Jev, lần lượt từng đoạn. Sau **3 đoạn liền nhau** Jev lỗi (đã tính cả thử lại), chuyển sang Gemini cho phần còn lại và thêm cảnh báo `"Jev failed repeatedly; switched to Gemini tagger at chunk N"`. Đoạn nào Gemini cũng lỗi thì là `null`.
    - Không có `TYPESAFE_API_KEY` thì dùng Gemini ngay từ đầu, kèm một cảnh báo.
  - `TaggingService.tagOne(text: string): Promise<TagResult>`: dùng cho nút "retag". Thử Jev, lỗi thì sang Gemini, cả hai lỗi thì throw.

- [ ] **Step 1: Viết test lỗi**

```ts
it("JevTagger builds one choice + one noul per taxonomy tag and applies the threshold", async () => {
  axiosPost.mockResolvedValue({ data: { answers: {
    domain: { type: "choice", choice: "conditions", probabilities: { conditions: 0.99, guidelines: 0.01, safety: 0 } },
    conditions__diabetes: { type: "noul", noul: 0.99 }, allergens__shellfish: { type: "noul", noul: 0.96 },
    allergens__peanuts: { type: "noul", noul: 0.01 } } } });
  const r = await tagger.tag("Người bệnh tiểu đường… dị ứng tôm cua…");
  const body = axiosPost.mock.calls[0][1];
  expect(body.model).toBe("jev-latest");
  expect(Object.keys(body.questions)).toHaveLength(1 + totalTaxonomyTags);
  expect(r).toMatchObject({ domain: "conditions", tagger: "jev",
    tags: { conditions: ["diabetes"], allergens: ["shellfish"] } });
  expect(r.scores["allergens:peanuts"]).toBe(0.01);
});
it("JevTagger retries on 429 then succeeds", async () => { /* fake timers; 2 lần 429 rồi ok → 3 lần gọi */ });
it("GeminiTagger drops tags outside the taxonomy", async () => { /* chat trả conditions ["diabetes","cancer"] → ["diabetes"] */ });
it("TaggingService switches to Gemini after 3 consecutive Jev failures", async () => {
  // jev.tag lỗi ở text 0,1,2 → gemini dùng cho 0..n-1 từ lúc chuyển; warnings có 1 phần tử chứa "switched to Gemini"
});
it("TaggingService does not switch when Jev failures are not consecutive", async () => { /* lỗi, ok, lỗi, ok… → vẫn dùng jev; đoạn lỗi được thử bằng gemini cho riêng đoạn đó */ });
it("TaggingService returns null when both taggers fail for a chunk", async () => {});
```

Ghi chú cho người làm: khi Jev lỗi ở một đoạn (nhưng chưa tới 3 lần liền), đoạn đó được gắn bằng Gemini ngay. Bộ đếm "liền nhau" chỉ quyết định việc chuyển hẳn sang Gemini.

- [ ] **Step 2: Chạy test, thấy lỗi** — `npm test -- src/rag-ingest/taggers`.
- [ ] **Step 3: Viết code.**
- [ ] **Step 4: Chạy test, thấy pass.**
- [ ] **Step 5: `.env.example`:** `TYPESAFE_API_KEY=`, `TYPESAFE_API_URL=https://api.typesafe.ai/v1`, `JEV_MODEL=jev-latest`, `RAG_TAGGER=jev`, `RAG_TAG_THRESHOLD=0.5`.
- [ ] **Step 6: Commit** — `git commit -m "feat(rag-ingest): Jev and Gemini taggers with fallback"`

---

### Task 10: Lưu file, kế hoạch ghép đoạn và `RagStoreService`

**Files:**
- Create: `src/rag-ingest/rag-file-storage.service.ts`, `src/rag-ingest/chunk-merge-planner.ts`, `src/rag-ingest/rag-store.service.ts`
- Test: `src/rag-ingest/rag-file-storage.service.spec.ts`, `src/rag-ingest/chunk-merge-planner.spec.ts`, `src/rag-ingest/rag-store.service.spec.ts`

**Interfaces:**
- Produces (file storage, gốc `RAG_STORAGE_DIR`, mặc định `./storage/rag`):
  - `saveSourcePdf(documentId: string, buffer: Buffer): Promise<string>` → đường dẫn tương đối `documents/<id>/source.pdf`
  - `saveImage(documentId: string, name: string, image: InlineImage): Promise<string>` → `documents/<id>/images/<name>.<ext>`
  - `readFile(relativePath: string): Promise<Buffer>`: throw nếu đường dẫn sau khi resolve nằm ngoài thư mục gốc (chống path traversal).
  - `deleteDocumentDir(documentId: string): Promise<void>`: không lỗi nếu thư mục không tồn tại.
- Produces (planner, thuần):

```ts
export type ExistingChunkState = { id: string; chunkKey: string; sourceContentHash: string | null; isManuallyEdited: boolean };
export type ChunkMergePlan = {
  insertKeys: string[];      // key mới
  replaceKeys: string[];     // chưa sửa tay và nội dung gốc đã đổi
  unchangedKeys: string[];   // nội dung gốc không đổi (sửa tay hay không)
  flagReviewKeys: string[];  // đã sửa tay và nội dung gốc đổi → giữ content, đặt needs_review, cập nhật source_content_hash
  flagReviewMissingIds: string[]; // đã sửa tay, không còn trong bản mới → giữ, đặt needs_review
  deleteIds: string[];       // chưa sửa tay, không còn trong bản mới
};
export function planChunkMerge(existing: ExistingChunkState[], drafts: { chunkKey: string; sourceContentHash: string }[]): ChunkMergePlan;
```

- Produces (`RagStoreService`, dùng `DataSource`):
  - Kiểu: `RagDocumentRow`, `RagJobRow`, `RagChunkRow`, theo đúng tên cột của Task 2, field ở dạng camelCase.
  - Documents:
    - `createDocument(input: { sourceType: "url" | "pdf"; sourceUrl?: string; originalFilename?: string; fileHash?: string; title: string; createdBy?: number }): Promise<RagDocumentRow>` (id = `randomUUID()`)
    - `findDocumentBySourceUrl(url: string)`, `findDocumentByFileHash(hash: string)`, `getDocument(id: string)`
    - `listDocuments(q: { search?: string; status?: string; language?: string; page: number; limit: number }): Promise<{ rows: (RagDocumentRow & { latestJob: RagJobRow | null })[]; total: number }>`
    - `updateDocument(id: string, patch: Partial<Pick<RagDocumentRow, "title" | "filePath" | "status" | "language" | "chunkCount">>)`
    - `deleteDocument(id: string): Promise<boolean>`
  - Jobs:
    - `enqueueJob(documentId: string): Promise<RagJobRow>` (đặt document `status='pending'`)
    - `hasActiveJob(documentId: string): Promise<boolean>`
    - `claimNextJob(): Promise<RagJobRow | null>`: `UPDATE … SET status='running', started_at=now() WHERE id = (SELECT id FROM rag_ingest_jobs WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, và đặt document `status='processing'`.
    - `updateJobProgress(jobId: string, stage: string, progress: number)`
    - `finishJob(jobId: string, warnings: string[])`
    - `failJob(jobId: string, message: string, warnings: string[])` (đặt document `failed`)
    - `resetRunningJobs(): Promise<number>` (job `running` → `pending`, document `processing` → `pending`)
  - Chunks:
    - `getExistingChunkStates(documentId: string): Promise<ExistingChunkState[]>`
    - `listChunks(documentId: string, f: { blockKind?: string; needsReview?: boolean; isActive?: boolean }): Promise<RagChunkRow[]>`
    - `getChunk(id: string)`
    - `updateChunk(id: string, patch: { content?: string; domain?: RagDomain; tags?: RagTags; isActive?: boolean; isManuallyEdited?: boolean; needsReview?: boolean; tagScores?: Record<string, number>; tagger?: string })`
    - `upsertEmbedding(chunkId: string, embedding: number[], contentHash: string, model: string)`
  - Ghi kết quả nạp:
    - `applyIngestResult(documentId: string, input: { title: string; language: "en" | "vi" | "mixed"; chunks: ReadyChunk[]; draftKeys: { chunkKey: string; sourceContentHash: string }[] }): Promise<{ documentMissing: boolean; plan?: ChunkMergePlan }>`
    - `type ReadyChunk = DraftChunk & { id: string; domain: RagDomain; tags: RagTags; tagScores: Record<string, number>; tagger: string | null; tagFailed: boolean; imagePath: string | null; embedding: number[]; embeddingHash: string }`
    - Chạy trong **một transaction**:
      1. `SELECT id FROM rag_documents WHERE id=$1 FOR UPDATE`. Không có dòng nào thì trả `{ documentMissing: true }`.
      2. Đọc `ExistingChunkState` **trong transaction**, rồi gọi `planChunkMerge(existing, draftKeys)`.
      3. Insert `insertKeys`. Update `replaceKeys` (content, nhãn, embedding, `source_content_hash`; **không đổi `is_active`**). Bỏ qua `unchangedKeys`. `flagReviewKeys` thì `needs_review=true` và cập nhật `source_content_hash`. `flagReviewMissingIds` thì `needs_review=true`. Xóa `deleteIds`.
      4. Update `rag_documents`:
         - `title` = `input.title`, **chỉ khi** title hiện tại vẫn bằng title tạm lúc tạo, tức là `source_url` với tài liệu URL, hoặc `original_filename` bỏ đuôi `.pdf` với tài liệu PDF. Nếu admin đã đổi tên thì giữ nguyên.
         - `language`
         - `chunk_count` = số đoạn sau khi ghép
         - `status='ready'`
    - Id của đoạn = `${documentId}-${chunkKey}`. Đoạn có `tagFailed` thì ghi `metadata.tagError=true`. `tagger` ghi vào `metadata.tagger`. Cột `domain` và `metadata.domain` luôn cùng giá trị.

- [ ] **Step 1: Viết test lỗi** cho planner (đủ 6 nhóm và các ca biên):

```ts
const ex = (k: string, h: string, locked = false) => ({ id: `d-${k}`, chunkKey: k, sourceContentHash: h, isManuallyEdited: locked });
it("plans every case", () => {
  const plan = planChunkMerge(
    [ex("a", "1"), ex("b", "1"), ex("c", "1", true), ex("d", "1", true), ex("e", "1"), ex("f", "1", true)],
    [{ chunkKey: "a", sourceContentHash: "1" }, { chunkKey: "b", sourceContentHash: "2" },
     { chunkKey: "c", sourceContentHash: "2" }, { chunkKey: "d", sourceContentHash: "1" }, { chunkKey: "g", sourceContentHash: "1" }]);
  expect(plan).toEqual({ insertKeys: ["g"], replaceKeys: ["b"], unchangedKeys: ["a", "d"],
    flagReviewKeys: ["c"], flagReviewMissingIds: ["d-f"], deleteIds: ["d-e"] });
});
```

Test cho storage dùng thư mục tạm (`fs.mkdtemp`): lưu rồi đọc lại đúng nội dung; `readFile("../../etc/passwd")` throw; `deleteDocumentDir` chạy được khi thư mục không có.

Test cho `RagStoreService` với `DataSource` mock (`query`, `transaction(cb)` gọi `cb(manager)` trong đó `manager.query` là mock):
  - `claimNextJob` gửi SQL có `FOR UPDATE SKIP LOCKED`.
  - `applyIngestResult` trả `{ documentMissing: true }` và không ghi gì khi `SELECT … FOR UPDATE` trả 0 dòng.
  - **Review Focus 2:** `getExistingChunkStates` lúc job bắt đầu nói đoạn `c` chưa sửa tay, nhưng trong transaction `manager.query` trả về `c` với `is_manually_edited=true`. Mong đợi: không có lệnh UPDATE nào ghi đè `content` của `c`, và có lệnh đặt `needs_review` cho `c`.
  - UPDATE cho `replaceKeys` không chứa `is_active`.

- [ ] **Step 2: Chạy test, thấy lỗi** — `npm test -- src/rag-ingest/chunk-merge-planner.spec.ts src/rag-ingest/rag-file-storage.service.spec.ts src/rag-ingest/rag-store.service.spec.ts`.
- [ ] **Step 3: Viết code.**
- [ ] **Step 4: Chạy test, thấy pass.**
- [ ] **Step 5: `.env.example`:** `RAG_STORAGE_DIR=./storage/rag`. Thêm `storage/` vào `.gitignore` và `.dockerignore`.
- [ ] **Step 6: Commit** — `git commit -m "feat(rag-ingest): file storage, chunk merge planner and store"`

---

### Task 11: Pipeline, worker và module

**Files:**
- Create: `src/rag-ingest/rag-ingest.pipeline.ts`, `src/rag-ingest/rag-ingest.worker.ts`, `src/rag-ingest/rag-ingest.module.ts`
- Modify: `src/app.module.ts` (import `RagIngestModule`)
- Test: `src/rag-ingest/rag-ingest.pipeline.spec.ts`, `src/rag-ingest/rag-ingest.worker.spec.ts`

**Interfaces:**
- Consumes: `DoclingClient`, `ImageTranscriberService`, `chunkDocument`, `buildEmbeddingText`, `TaggingService`, `VectorService.embedDocuments`, `RagFileStorageService`, `RagStoreService`, `RetrievalService.scheduleRebuild`, `documentLanguage`.
- Produces:
  - `RagIngestPipeline.run(job: RagJobRow): Promise<void>`: không bao giờ throw ra ngoài. Mọi lỗi được chuyển thành `failJob` với thông báo đọc được.
  - `RagIngestWorker`:
    - `onModuleInit`: gọi `resetRunningJobs()`, rồi nếu `RAG_INGEST_WORKER_ENABLED !== "false"` thì đăng ký interval `RAG_INGEST_POLL_MS` (mặc định 5000) qua `SchedulerRegistry`.
    - `tick(): Promise<void>`: có cờ `busy`, nên một tick đang chạy thì các tick sau bỏ qua. Nhận đúng 1 job rồi gọi `pipeline.run`.
  - `RagIngestModule`: imports `RetrievalModule`, `OllamaModule`. Exports `RagStoreService`, `RagFileStorageService`, `TaggingService`, `DoclingClient`.
- Các bước của `run` (`stage`, `progress`):

| stage | progress | Việc |
|---|---|---|
| `extracting` | 5 | `convertPdf(readFile(doc.filePath))` hoặc `convertUrl(doc.sourceUrl)`. Lỗi: `UNAVAILABLE` → "Document converter is unavailable"; `FETCH_FAILED` → "Could not download the page (blocked or not found)". `pageCount > RAG_MAX_PDF_PAGES` → "PDF has N pages; the limit is M". Nếu tổng số từ của heading và paragraph < 50: PDF → "PDF has no text layer (scanned PDFs are not supported)"; URL → "Page has no readable content (it may need JavaScript)". |
| `images` | 15–40 | `transcribeAll`. Nếu `skippedErrors > 0` thì cảnh báo "N images could not be read and were skipped". Lưu ảnh của các block có trong map bằng `saveImage`. |
| `chunking` | 45 | `chunkDocument`. 0 đoạn → lỗi "No content to index". |
| `tagging` | 50–80 | `getExistingChunkStates` + `planChunkMerge` để **chỉ gắn nhãn và embed các key thuộc `insertKeys` hoặc `replaceKeys`**. Gom warnings. Nếu `null` > 50% số đoạn cần gắn nhãn → lỗi "Tagging failed for more than half of the chunks". Đoạn `null` có `tagFailed=true`, `domain='guidelines'`, tags rỗng. |
| `embedding` | 80–95 | `embedDocuments(buildEmbeddingText(title, c))` cho các đoạn cần. `embeddingHash` = sha256 của text đó. |
| `saving` | 95 | `applyIngestResult`. Nếu `documentMissing` thì `deleteDocumentDir` rồi return, không gọi `finishJob` hay `failJob`. Ngược lại: `finishJob(warnings)` rồi `scheduleRebuild()`. |

Không ghi gì vào `rag_chunks` trước bước `saving`.

- [ ] **Step 1: Viết test lỗi** cho pipeline với mọi phụ thuộc là mock:
  - (a) Đi trọn luồng: stage được báo theo đúng thứ tự `extracting → images → chunking → tagging → embedding → saving`, `applyIngestResult` được gọi đúng 1 lần, rồi đến `finishJob` và `scheduleRebuild`.
  - (b) PDF có 10 từ → `failJob` với thông báo "PDF has no text layer…", và `applyIngestResult` không được gọi.
  - (c) Tagging trả 6/10 `null` → `failJob("Tagging failed for more than half of the chunks")`.
  - (d) 2 ảnh lỗi → job vẫn `finishJob`, warnings có "2 images could not be read".
  - (e) Khi nạp lại, các đoạn có `sourceContentHash` không đổi thì không được gửi cho tagging hay embedding.
  - (f) **Review Focus 3:** `applyIngestResult` trả `{ documentMissing: true }` → gọi `deleteDocumentDir`, không gọi `finishJob`, `failJob` hay `scheduleRebuild`.
  - (g) Docling throw `UNAVAILABLE` → `failJob("Document converter is unavailable")`.

  Test cho worker:
  - `tick` khi đang `busy` thì không nhận job mới.
  - `onModuleInit` gọi `resetRunningJobs` trước khi đăng ký interval.
  - `RAG_INGEST_WORKER_ENABLED=false` thì không đăng ký interval.
- [ ] **Step 2: Chạy test, thấy lỗi** — `npm test -- src/rag-ingest/rag-ingest.pipeline.spec.ts src/rag-ingest/rag-ingest.worker.spec.ts`.
- [ ] **Step 3: Viết code và nối module** vào `app.module.ts`.
- [ ] **Step 4: Chạy test, thấy pass.** Chạy `npm test` toàn bộ và `npm run build`.
- [ ] **Step 5: `.env.example`:** `RAG_INGEST_POLL_MS=5000`, `RAG_INGEST_WORKER_ENABLED=true`, `RAG_MAX_PDF_PAGES=300`.
- [ ] **Step 6: Commit** — `git commit -m "feat(rag-ingest): ingest pipeline and single-flight worker"`

---

### Task 12: API admin `/admin/rag/*`

**Files:**
- Create: `src/admin/rag-documents/admin-rag-documents.controller.ts`, `admin-rag-documents.service.ts`, `admin-rag-documents.exception.ts`, `dto/rag-document-list-query.dto.ts`, `dto/create-rag-url-request.dto.ts`, `dto/update-rag-document-request.dto.ts`, `dto/rag-chunk-list-query.dto.ts`, `dto/update-rag-chunk-request.dto.ts`, `dto/rag-responses.ts`; `src/rag-ingest/url-normalize.ts`
- Modify: `src/admin/admin.module.ts` (import `RagIngestModule`, `RetrievalModule`; thêm controller và service)
- Test: `src/admin/rag-documents/admin-rag-documents.service.spec.ts`, `src/rag-ingest/url-normalize.spec.ts`

**Interfaces:**
- Consumes: `RagStoreService`, `RagFileStorageService`, `TaggingService.tagOne`, `VectorService.embedDocuments`, `buildEmbeddingText`, `sanitizeTags`, `isRagDomain`, `RAG_TAXONOMY`, `RAG_DOMAINS`, `RetrievalService.scheduleRebuild`, `normalizeText`.
- Produces: `normalizeSourceUrl(raw: string): string | null`. Chỉ nhận `http`/`https`. Hạ chữ thường cho host, bỏ `#hash`, bỏ tham số `utm_*`, `fbclid`, `gclid`, bỏ `/` ở cuối (trừ đường dẫn gốc), sắp xếp lại các tham số còn lại. URL không hợp lệ → `null`.
- Produces (hợp đồng HTTP, Admin-page dựa vào đúng các tên này):

```ts
type RagJobDto = { id: string; status: "pending" | "running" | "done" | "failed"; stage: string | null;
  progress: number; errorMessage: string | null; warnings: string[]; startedAt: string | null; finishedAt: string | null };
type RagDocumentDto = { id: string; sourceType: "url" | "pdf"; sourceUrl: string | null; originalFilename: string | null;
  title: string; language: "en" | "vi" | "mixed" | null; status: "pending" | "processing" | "ready" | "failed";
  chunkCount: number; createdAt: string; updatedAt: string; latestJob: RagJobDto | null };
type RagChunkDto = { id: string; documentId: string; headingPath: string; pageFrom: number | null; pageTo: number | null;
  blockKind: "text" | "table" | "image"; language: "en" | "vi" | null; domain: RagDomain; tags: RagTags;
  tagScores: Record<string, number>; tagger: string | null; tagFailed: boolean; content: string; hasImage: boolean;
  isActive: boolean; isManuallyEdited: boolean; needsReview: boolean; updatedAt: string };
type RagTaxonomyDto = { domains: RagTaxonomyItem[]; groups: Record<RagTagGroup, RagTaxonomyItem[]> };
```

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/admin/rag/documents/url` | `{ url }` | `{ success, data: RagDocumentDto, created: boolean }` |
| POST | `/admin/rag/documents/upload` | multipart field `file` | `{ success, data: RagDocumentDto, created: boolean }` |
| GET | `/admin/rag/documents` | `search, status, language, page=1, limit=20 (≤100)` | `{ success, data: RagDocumentDto[], pagination: { page, limit, total, totalPages } }` |
| GET | `/admin/rag/documents/:id` | | `{ success, data: RagDocumentDto }` |
| PATCH | `/admin/rag/documents/:id` | `{ title }` | `{ success, data: RagDocumentDto }` |
| POST | `/admin/rag/documents/:id/reingest` | | `{ success, data: RagDocumentDto }` |
| DELETE | `/admin/rag/documents/:id` | | `{ success, message }` |
| GET | `/admin/rag/documents/:id/chunks` | `blockKind, needsReview, isActive` | `{ success, data: RagChunkDto[] }` |
| PATCH | `/admin/rag/chunks/:id` | `{ content?, domain?, tags?, isActive? }` | `{ success, data: RagChunkDto }` |
| POST | `/admin/rag/chunks/:id/retag` | | `{ success, data: RagChunkDto }` |
| POST | `/admin/rag/chunks/:id/resolve-review` | | `{ success, data: RagChunkDto }` |
| GET | `/admin/rag/chunks/:id/image` | | file ảnh (`StreamableFile`, header `Content-Type` đúng loại ảnh) |
| GET | `/admin/rag/taxonomy` | | `{ success, data: RagTaxonomyDto }` |

- Mã lỗi (`AdminRagException`, theo mẫu `AdminFoodException`):

| Mã | HTTP |
|---|---|
| `RAG_DOCUMENT_NOT_FOUND` | 404 |
| `RAG_CHUNK_NOT_FOUND` | 404 |
| `RAG_IMAGE_NOT_FOUND` | 404 |
| `RAG_INVALID_URL` | 400 |
| `RAG_INVALID_FILE` | 400 |
| `RAG_FILE_TOO_LARGE` | 413 |
| `RAG_INVALID_TAG` | 400 (message liệt kê các giá trị `invalid` do `sanitizeTags` trả về) |
| `RAG_INVALID_DOMAIN` | 400 |
| `RAG_JOB_IN_PROGRESS` | 409 (reingest khi đã có job `pending` hoặc `running`) |
| `RAG_TAGGING_FAILED` | 502 |
| `VALIDATION_ERROR` | 400 |

- Hành vi:
  - **`createdBy`:** controller lấy từ `req.user.userId` (kiểu `AdminJwtUser` trong `admin-jwt-auth.guard.ts`) và truyền vào service.
  - **Thêm URL:** chuẩn hóa URL. Nếu đã có tài liệu với URL đó thì trả về nó với `created:false`. Ngược lại `createDocument(title = url)` rồi `enqueueJob`.
  - **Upload:** `FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024 } })` dùng memory storage. Kiểm tra mimetype `application/pdf` và 5 byte đầu là `%PDF-`. Tính sha256 để chống trùng. `createDocument(title = tên file bỏ đuôi .pdf)`, lưu file bằng `saveSourcePdf`, cập nhật `filePath`, rồi `enqueueJob`. Lỗi `LIMIT_FILE_SIZE` của multer → `RAG_FILE_TOO_LARGE`.
  - **PATCH chunk:**
    - `content` đổi: NFC, embed lại (`embedDocuments([buildEmbeddingText(docTitle, …)])`), `upsertEmbedding`, đặt `is_manually_edited=true`.
    - `tags` qua `sanitizeTags`. Có giá trị `invalid` → `RAG_INVALID_TAG`, không lưu gì.
    - `domain` không hợp lệ → `RAG_INVALID_DOMAIN`.
    - Sửa `tags` hoặc `domain` cũng đặt `is_manually_edited=true`.
    - Chỉ đổi `isActive` thì **không** đặt `is_manually_edited`.
  - **Retag:** `tagOne(content)` → ghi đè `domain`, `tags`, `tagScores`, `tagger`, xóa `tagError`. Không đổi `is_manually_edited`. Lỗi → `RAG_TAGGING_FAILED`.
  - **Xóa tài liệu:** `deleteDocument` (DB cascade xóa job và đoạn; `rag_embeddings` có FK cascade theo đoạn), rồi `deleteDocumentDir`.
  - **Mọi thay đổi kho** (sửa đoạn, retag, bật/tắt, xóa) đều gọi `scheduleRebuild()`.

- [ ] **Step 1: Viết test lỗi** cho `url-normalize`:

```ts
it.each([
  ["https://WHO.int/news/fact-sheets/healthy-diet/", "https://who.int/news/fact-sheets/healthy-diet"],
  ["https://who.int/a?utm_source=x&b=2&a=1#top", "https://who.int/a?a=1&b=2"],
  ["https://who.int/", "https://who.int/"],
])("normalizes %s", (input, expected) => expect(normalizeSourceUrl(input)).toBe(expected));
it("rejects non-http urls", () => {
  expect(normalizeSourceUrl("ftp://x")).toBeNull();
  expect(normalizeSourceUrl("not a url")).toBeNull();
});
```

  Test cho service (store, storage, tagging, vector và retrieval đều mock):
  - **Review Focus 5:** thêm URL `https://WHO.int/x/` khi đã có `https://who.int/x` → `created:false` và `enqueueJob` không được gọi.
  - Upload buffer không bắt đầu bằng `%PDF-` → `RAG_INVALID_FILE`.
  - Upload trùng hash → `created:false`.
  - PATCH `tags: { conditions: ["cancer"] }` → `RAG_INVALID_TAG`, `updateChunk` không được gọi.
  - PATCH `content` → `embedDocuments` được gọi với text có tiêu đề tài liệu, `updateChunk` nhận `isManuallyEdited:true`, `scheduleRebuild` được gọi.
  - PATCH chỉ `isActive:false` → `updateChunk` không nhận `isManuallyEdited`.
  - Reingest khi `hasActiveJob` → `RAG_JOB_IN_PROGRESS`.
  - Xóa → `deleteDocumentDir` được gọi sau `deleteDocument`.
  - `getTaxonomy()` trả đúng `RAG_TAXONOMY`.
- [ ] **Step 2: Chạy test, thấy lỗi** — `npm test -- src/admin/rag-documents src/rag-ingest/url-normalize.spec.ts`.
- [ ] **Step 3: Viết code** (controller theo mẫu `admin-foods.controller.ts`; endpoint ảnh dùng `@Res({ passthrough: true })` để đặt `Content-Type`).
- [ ] **Step 4: Chạy test, thấy pass.** Chạy `npm test` và `npm run build`.
- [ ] **Step 5: Commit** — `git commit -m "feat(admin): RAG knowledge base admin API"`

---

### Task 13: Hướng dẫn chạy và kiểm tra đầu-cuối

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Viết mục "RAG knowledge base" trong README** gồm:
  - `ollama pull bge-m3`
  - `docker compose -f docker-compose.rag.yml up -d`
  - Chạy `scripts/sql/rag-reset-embeddings-1024.sql` nếu DB còn bảng `rag_embeddings` 768 chiều
  - Các biến `.env` mới
  - Khuyến nghị `OLLAMA_MAX_LOADED_MODELS=2` và `OLLAMA_NUM_PARALLEL=1`
  - Nhắc tạo key Jev mới và để trong `TYPESAFE_API_KEY`
  - Thư mục `RAG_STORAGE_DIR` phải là volume khi chạy Docker
- [ ] **Step 2: Chạy local đầu-cuối** (server, Postgres, Ollama và Docling). Dùng `curl` với token admin (lấy qua `POST /admin/auth/login`), kiểm tra lần lượt các mục của spec §14:
  1. Thêm `https://www.who.int/news-room/fact-sheets/detail/healthy-diet`. Gọi `GET /admin/rag/documents/:id` cho tới khi `status=ready`. `chunkCount > 0`.
  2. Tải lên một PDF tiếng Việt có bảng và infographic → `ready`.
  3. Mở 10 đoạn `blockKind=table`, so số với PDF: phải khớp hoàn toàn.
  4. Mở các đoạn `blockKind=image`: số phải khớp với ảnh. Logo không tạo ra đoạn nào.
  5. Xem khoảng 30 đoạn: nhãn hợp lý. Đoạn nói cả về bệnh lẫn dị ứng phải có cả hai nhãn.
  6. PATCH content một đoạn. Gọi `GET /rag/evaluate?q=<từ trong nội dung mới>&mode=bm25-only` **không khởi động lại server** → thấy nội dung mới.
  7. Reingest tài liệu đó. Đoạn đã sửa vẫn giữ nội dung.
  8. PATCH `isActive:false`. `/rag/evaluate` không còn trả về đoạn đó.
  9. Trong lúc một job chạy, gọi API tạo món hoặc dashboard AI: vẫn trả lời bình thường.
  10. Khởi động lại server với kho trống: server lên bình thường.
- [ ] **Step 3: Commit** — `git commit -m "docs: RAG knowledge base setup and verification"`
