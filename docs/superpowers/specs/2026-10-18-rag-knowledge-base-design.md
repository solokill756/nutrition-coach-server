# Thiết kế: Kho tài liệu RAG và công cụ nạp tài liệu (Dự án 1)

Ngày: 2026-10-18
Phạm vi: `nutrition-coach-server` (backend) + repo `Admin-page` (https://github.com/solokill756/Admin-page, frontend quản trị)

---

## 1. Bối cảnh và lý do

RAG hiện được dùng ở hai chỗ: **Recipe Builder** (`recipe-builder.service.ts`, gọi `RetrievalService.retrieve`) và **Dashboard AI** (`dashboard-ai.service.ts`). Cả hai đọc kho tài liệu trong bảng `rag_chunks` / `rag_embeddings` (Postgres + pgvector).

Vấn đề:

- **Kho tài liệu đã mất**, phải xây lại từ đầu. Trong repo cũng không còn script nạp tài liệu nào: server chỉ có code *đọc* `rag_chunks`.
- Tìm tài liệu đang sai vì ba lý do chính:
  1. Câu truy vấn là một đoạn hồ sơ người dùng dài, trộn nhiều ý.
  2. Embedding bị bỏ dấu tiếng Việt, và `nomic-embed-text` yếu với tiếng Việt cũng như việc ghép truy vấn tiếng Anh với tài liệu tiếng Việt.
  3. Lọc domain cứng: mỗi truy vấn chỉ có một intent, nên cả nhóm tài liệu bị chặn.
- Tài liệu mới sẽ có **cả tiếng Anh lẫn tiếng Việt**, lấy từ **PDF tải từ web** (có bảng và ảnh) và **trang web**.

Dự án này dựng lại kho **theo cách giúp tìm đúng về sau**. Mỗi đoạn được gắn **nhãn có cấu trúc**, dùng đúng các giá trị có trong hồ sơ người dùng (bệnh, dị ứng, mục tiêu, chất dinh dưỡng). Embedding dùng model đa ngôn ngữ. Admin quản lý và sửa kho qua trang quản trị.

Việc sửa phía tìm kiếm (tách truy vấn theo mảng, lọc theo nhãn, BM25 song ngữ) là **Dự án 2**, có tài liệu thiết kế riêng. Dự án 1 chỉ sửa phía tìm kiếm ở mức tối thiểu để kho mới dùng được (mục 9).

## 2. Mục tiêu, ngoài phạm vi, điều không được xảy ra

### Mục tiêu
- Admin thêm tài liệu bằng cách **dán link trang web** hoặc **tải lên file PDF** trên trang quản trị.
- Hệ thống tự xử lý trong **job chạy nền**: lấy nội dung (kể cả bảng và chữ trong ảnh), chia đoạn, gắn nhãn, tạo embedding, rồi ghi vào kho.
- Admin xem trạng thái job, xem các đoạn và nhãn của từng tài liệu, **sửa tay** nội dung và nhãn, bật/tắt từng đoạn, chạy lại, xóa tài liệu.
- Mỗi đoạn có nhãn đa giá trị, lấy từ một **danh sách nhãn cố định** khớp với giá trị trong hồ sơ người dùng.
- Kho giữ tài liệu **đúng ngôn ngữ gốc** (EN hoặc VI). Không dịch.

### Ngoài phạm vi
- Dự án 2: đổi cách tạo truy vấn, lọc theo nhãn khi tìm, BM25 song ngữ, bỏ lọc domain cứng.
- `food_embeddings` / ghép nguyên liệu (`FoodSemanticSearchService`): giữ nguyên.
- Crawl nhiều trang hoặc cả sitemap: mỗi lần chỉ nạp một URL.
- Trang web cần chạy JavaScript mới hiện nội dung: báo lỗi, không hỗ trợ.
- PDF scan (chỉ có ảnh, không có lớp chữ): báo lỗi rõ ràng, không OCR cả trang.
- Lưu lịch sử phiên bản của đoạn.
- Chạy nhiều instance server cùng lúc (mục 3).

### Điều không được xảy ra (thất bại dù code chạy được)
- **Số liệu dinh dưỡng sai mà không ai biết.** Số trong bảng hoặc trong ảnh bị đọc lệch rồi lặng lẽ vào câu trả lời cho người dùng. Đây là rủi ro lớn nhất, và các quyết định ở mục 7.3, 7.4 và 8 đều nhằm tránh nó.
- **Nạp tài liệu làm chậm hoặc treo server đang phục vụ người dùng.**
- **Thiết kế phụ thuộc cứng vào Jev.** Jev đang ở giai đoạn truy cập sớm. Phải đổi được sang cách gắn nhãn khác mà không sửa phần còn lại.
- **Nhãn "trôi"**: cùng một khái niệm mang nhiều tên (`diabetes` / `tiểu đường` / `type 2 diabetes`).
- Bản sửa tay của admin bị ghi đè khi nạp lại tài liệu.

## 3. Ràng buộc

- **Máy chạy: chỉ có CPU, 16GB RAM**, không có GPU. Không chạy model đọc ảnh tại máy.
- **LLM chạy qua `platform` hoặc `gemini`** (`LLM_PROVIDER`, mặc định `platform`). Ollama **chỉ dùng để tạo embedding** (xem `ollama.service.ts`, `logRuntimeConfig`). `OllamaService.chat` hiện chỉ nhận chữ. Riêng `src/recipe-builder/ai-ingredient-vision.service.ts` **đã gửi ảnh** (`inline_data`) qua cả `platform` lẫn `gemini`. Ở chế độ `platform`, key Gemini thật nằm phía platform, server không giữ key.
- Backend: NestJS, Postgres + pgvector. Schema RAG được tạo bằng SQL thô lúc khởi động (`PostgresRagService.ensureSchema`). TypeORM `synchronize` chỉ bật ở dev và repo không dùng migration.
- Đã có `@nestjs/schedule`, **không có** Redis hay BullMQ.
- Đã có module `src/admin/` với `AdminJwtAuthGuard`, `AdminRoleGuard` và `AdminAuthExceptionFilter`. Theo mẫu `admin-condition-rules.controller.ts`.
- Frontend `Admin-page`: React 19, Vite, react-router 7, `lucide-react`, **không có thư viện UI**. Code chia theo module `src/modules/<x>/{api,hooks,pages,components,types}` và tự viết CSS (`styles.css`). Giao diện hiện tại bằng tiếng Anh.
- **Jev** (TypeSafe, `https://api.typesafe.ai/v1/systemone`, model `jev-latest`): dùng được với API key và đã thử, hiểu tiếng Việt, mất khoảng 0.45 giây mỗi request. Key nằm trong `TYPESAFE_API_KEY` và không commit. Key cũ đã lộ trong chat, cần thay key mới.
- **Giả định một instance server**: index BM25 nằm trong bộ nhớ, và worker job chạy trong cùng process.

## 4. Những gì đã quyết định

### Chủ dự án đã chốt
- Xây lại kho từ **PDF và trang web**. Tài liệu có cả tiếng Anh và tiếng Việt.
- Giữ **đa ngôn ngữ**, không dịch tài liệu về một thứ tiếng.
- Thêm tài liệu qua **trang web quản trị** (repo `Admin-page`).
- **Lấy cả chữ và số nằm trong ảnh** của PDF.
- Máy chỉ có CPU, 16GB: không đọc ảnh tại máy, mà dùng **Gemini** (đã tích hợp sẵn).
- **Gắn nhãn bằng Jev.**
- Admin **tự sửa tay** nội dung và nhãn trên trang quản trị.
- Danh sách nhãn lấy từ các danh sách đang có trong hồ sơ người dùng.
- **Đoạn lấy từ ảnh được dùng ngay** khi job xong (`is_active = true`), không chờ admin duyệt. Chủ dự án chấp nhận rủi ro số liệu đọc sai trong khoảng thời gian trước khi admin xem lại. Lớp bảo vệ là việc hiện ảnh gốc cạnh đoạn trên trang quản trị, cùng bộ lọc "image" để admin rà các đoạn này. Đoạn lấy từ bảng cũng được dùng ngay (chuyển bằng code, không qua AI).

### Quyết định của người viết thiết kế (chủ dự án chưa xác nhận từng điểm, có thể đổi)
- Embedding: **`bge-m3`** chạy trên Ollama (1024 chiều), **giữ nguyên dấu**.
- Đọc PDF và trang web: **Docling**, chạy thành service riêng (`docling-serve`, Docker), **tắt OCR**.
- Hàng đợi job đặt **trong Postgres** và chạy **từng job một**.
- Bảng được chuyển thành câu **bằng code**, không qua LLM (mục 7.3).
- Gemini vừa quyết định ảnh có thông tin hay không, vừa chép lại nội dung, trong **cùng một lời gọi** (mục 7.4).
- Giao diện quản trị dùng **bố cục hai cột** (mockup "B"). Chữ trên giao diện bằng **tiếng Anh**, giống phần còn lại của Admin-page.
- File gốc (PDF, ảnh) lưu trên **ổ đĩa** theo thư mục cấu hình.
- Phương án dự phòng khi không có Jev là **Gemini**, không phải Ollama, vì Ollama không còn chạy chat.
- Gọi Gemini có ảnh **qua cùng công tắc `LLM_PROVIDER`** như `AiIngredientVisionService` (tách thành client dùng chung).
- Mọi thứ chạy chung một máy. Công cụ nạp phải tự giới hạn tài nguyên (mục 7.1). Thêm `docker-compose.rag.yml` cho Docling.
- Jev lỗi liên tục thì tự chuyển sang Gemini cho phần còn lại của job.

## 5. Tổng quan luồng

```
Admin-page ──(URL hoặc PDF)──► POST /admin/rag/documents/...
                                  │  tạo rag_documents + rag_ingest_jobs (pending)
                                  ▼
                 RagIngestWorker (@nestjs/schedule, từng job một)
                                  │
   1. Lấy nội dung ── docling-serve (HTML / PDF → cấu trúc: tiêu đề, đoạn văn, bảng, ảnh, số trang)
   2. Ảnh ────────── Gemini (có thông tin không? nếu có thì chép lại)  → khối "image"
   3. Bảng ───────── code: mỗi dòng → câu có tiêu đề bảng và tên cột  → khối "table"
   4. Chia đoạn ──── theo cấu trúc tiêu đề, kèm heading path và số trang
   5. Gắn nhãn ───── Tagger (Jev mặc định, Gemini dự phòng) → domain + tags + xác suất
   6. Embedding ──── Ollama bge-m3 (1024 chiều)
   7. Ghi ────────── rag_chunks + rag_embeddings (giữ các đoạn đã sửa tay)
   8. Báo RetrievalService dựng lại index
```

## 6. Dữ liệu

### 6.1 Bảng mới `rag_documents`
Mỗi dòng là một tài liệu nguồn.

| Cột | Ý nghĩa |
|---|---|
| `id` (text/uuid, PK) | |
| `source_type` | `url` \| `pdf` |
| `source_url` | URL gốc (với PDF tải lên thì để trống) |
| `original_filename` | tên file PDF tải lên |
| `file_path` | đường dẫn file gốc trên đĩa (PDF, hoặc HTML đã tải nếu muốn) |
| `file_hash` | sha256 của file hoặc nội dung đã tải, để phát hiện trùng |
| `title` | tiêu đề (lấy từ tài liệu, admin sửa được) |
| `language` | `en` \| `vi` \| `mixed` |
| `status` | `pending` \| `processing` \| `ready` \| `failed` |
| `chunk_count`, `created_at`, `updated_at`, `created_by` (admin id) | |

Thêm cùng một URL hoặc cùng `file_hash` lần nữa thì **không tạo tài liệu mới**. API trả về tài liệu đang có, và admin dùng nút "Chạy lại" nếu muốn xử lý lại.

### 6.2 Bảng mới `rag_ingest_jobs`
| Cột | Ý nghĩa |
|---|---|
| `id`, `document_id` (FK → rag_documents, ON DELETE CASCADE) | |
| `status` | `pending` \| `running` \| `done` \| `failed` |
| `stage` | `extracting` \| `images` \| `chunking` \| `tagging` \| `embedding` \| `saving` |
| `progress` | 0–100 |
| `error_message` | lý do lỗi, đọc được bằng mắt (ví dụ "Trang chặn tải (403)", "PDF không có lớp chữ") |
| `attempt`, `started_at`, `finished_at`, `created_at` | |

### 6.3 Thay đổi `rag_chunks`
Giữ các cột hiện có (`id, doc_id, source, title, content, metadata, content_hash`). `doc_id` trỏ tới `rag_documents.id`. Thêm:

| Cột | Ý nghĩa |
|---|---|
| `chunk_key` | khóa ổn định trong tài liệu, dùng để ghép đoạn khi nạp lại (mục 8) |
| `heading_path` | ví dụ `Chương 3 › Natri › Người tăng huyết áp` |
| `page_from`, `page_to` | số trang (PDF) |
| `block_kind` | `text` \| `table` \| `image` |
| `image_path` | đường dẫn ảnh gốc nếu `block_kind = image` |
| `language` | `en` \| `vi` |
| `domain` | `guidelines` \| `conditions` \| `safety` (một giá trị, để tương thích với retrieval hiện tại) |
| `tags` (jsonb) | `{ "conditions": [...], "allergens": [...], "goals": [...], "nutrients": [...] }` |
| `tag_scores` (jsonb) | xác suất của từng nhãn do Tagger trả về, để kiểm tra lại |
| `is_active` (bool, mặc định true) | tắt thì RAG không dùng |
| `is_manually_edited` (bool) | đã sửa tay thì khóa, nạp lại không ghi đè |
| `needs_review` (bool) | bản gốc đã đổi ở một đoạn đang khóa (mục 8) |
| `source_content_hash` | hash nội dung máy lấy ra (khác với `content_hash` của nội dung đang dùng) |

`metadata` vẫn giữ `domain`, đồng thời thêm `tags` và `link` để code đọc `metadata.domain` hiện tại vẫn chạy (`retrieval.utils.ts`). Người làm có thể chọn chỉ dùng cột riêng nếu sửa luôn chỗ đọc.

### 6.4 `rag_embeddings`
- Đổi thành `vector(1024)`, `model = 'bge-m3'`.
- Vì `ensureSchema` dùng `CREATE TABLE IF NOT EXISTS`, bảng cũ 768 chiều sẽ không tự đổi. Cần một **script SQL** để drop và tạo lại `rag_embeddings` (kho cũ đã mất nên không phải giữ dữ liệu). Thêm một bước kiểm tra lúc khởi động: nếu số chiều trong DB khác cấu hình thì log lỗi rõ ràng.
- Index HNSW giữ như cũ.

### 6.5 Lưu file
- Thư mục `RAG_STORAGE_DIR` (mặc định `./storage/rag`). Cấu trúc: `documents/<docId>/source.pdf`, `documents/<docId>/images/<n>.png`.
- Docker: thư mục này phải là volume, không nằm trong image.
- Ảnh được trả về cho Admin-page qua endpoint có guard admin. Không public.
- Xóa tài liệu thì xóa luôn thư mục của nó.

## 7. Công cụ nạp tài liệu

### 7.1 Job và worker
- `RagIngestWorker` dùng `@nestjs/schedule` (interval, ví dụ 5 giây) để nhận một job `pending`. Dùng `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` để không nhận trùng job.
- **Mỗi lúc chỉ chạy một job** để vừa 16GB RAM.
- **Tất cả chạy chung một máy** (CPU, 16GB): API, Postgres, Ollama (`bge-m3` và `nomic-embed-text`) và `docling-serve`. Vì vậy công cụ nạp phải nhường tài nguyên cho người dùng:
  - Embedding lúc nạp gửi **lần lượt** (hoặc theo lô nhỏ, ví dụ 8 đoạn), không bắn song song, để truy vấn của người dùng không phải xếp hàng lâu sau Ollama.
  - Giới hạn số trang PDF (`RAG_MAX_PDF_PAGES`, mặc định 300). Vượt quá thì báo lỗi rõ ràng.
  - Container `docling-serve` đặt giới hạn bộ nhớ (ví dụ 4GB) và chỉ 1 worker.
  - Ollama: khuyến nghị `OLLAMA_MAX_LOADED_MODELS=2` và `OLLAMA_NUM_PARALLEL=1` trong hướng dẫn cài đặt.
- Lúc khởi động, job đang `running` (vì server bị tắt giữa chừng) được đưa về `pending`.
- Mỗi bước cập nhật `stage` và `progress` để Admin-page hiện tiến độ.
- Lỗi thì `status=failed` kèm `error_message`. Không tự chạy lại cả job. Từng lời gọi ra ngoài (Docling, Gemini, Jev, Ollama) có thể thử lại vài lần khi lỗi tạm thời. Admin bấm "Chạy lại" để tạo job mới.
- Job lỗi giữa chừng **không được làm hỏng** dữ liệu đang có của tài liệu. Chỉ ghi vào `rag_chunks` ở bước cuối, trong một transaction.

### 7.2 Lấy nội dung: Docling
- Chạy `docling-serve` thành container riêng, server gọi qua HTTP (`DOCLING_URL`). Dùng cho **cả URL lẫn PDF** để hai loại nguồn ra cùng một cấu trúc (tiêu đề, đoạn văn, bảng có ô, ảnh kèm chú thích, số trang).
- **Tắt OCR toàn trang** (PDF đã có chữ). Bật trích ảnh (picture images) để lấy ảnh ra.
- PDF không có lớp chữ (gần như không lấy được chữ nào) thì cho job thất bại với thông báo rõ ràng.
- Trang web trả về rỗng hoặc gần rỗng (trang cần JavaScript) thì báo lỗi rõ ràng.
- Giới hạn file PDF tải lên: 50MB, chỉ nhận `application/pdf`.

### 7.3 Bảng
- **Không gửi bảng cho LLM**, để tránh số liệu bị đổi. Code chuyển từng dòng thành một câu có đủ ngữ cảnh, dùng tiêu đề hoặc chú thích bảng và tên cột. Ví dụ:
  `Bảng 5 – Nhu cầu năng lượng khuyến nghị. Nhóm: Nam 19–30 tuổi; Mức lao động: vừa; Năng lượng: 2.500 kcal/ngày; Protein: 60–70 g`.
- Bảng lớn được chia thành nhiều đoạn. Mỗi đoạn lặp lại tiêu đề bảng và tên cột.
- Tiêu đề cột gộp nhiều tầng thì nối lại bằng ` › `.
- `block_kind = table`.

### 7.4 Ảnh: Gemini
- Bỏ qua ảnh quá nhỏ (ngưỡng do người làm chọn, ví dụ dưới 120px ở một chiều) và ảnh lặp lại trên nhiều trang (logo).
- Mỗi ảnh còn lại được gửi **một lời gọi Gemini có ảnh**, kèm chú thích và một ít chữ xung quanh. Yêu cầu trả về JSON:
  `{ "has_information": boolean, "transcription": string }`.
  Hướng dẫn cho Gemini: chép **nguyên văn** chữ và số trong ảnh, giữ quan hệ nhãn–số (ví dụ "Tầng 2 – Rau củ: 300–400 g/ngày"), **không suy đoán, không thêm số**, giữ ngôn ngữ gốc.
- `has_information = false` thì bỏ ảnh. Ngược lại tạo khối `block_kind = image`, lưu file ảnh vào `image_path`, gắn với trang và heading của ảnh.
- Lời gọi có ảnh **đi theo cùng công tắc `LLM_PROVIDER` (`platform` | `gemini`) như `AiIngredientVisionService`**. Nên tách phần gửi request Gemini có ảnh của service đó (cả nhánh platform có mã hóa `PlatformCryptoService` lẫn nhánh gọi trực tiếp) ra thành một client dùng chung, để Recipe Builder và công cụ nạp cùng dùng. Không viết thêm một đường gọi riêng chỉ dùng `GEMINI_API_KEY`. Model cấu hình bằng `GEMINI_VISION_MODEL`, mặc định là model Gemini đang dùng.
- Nếu lời gọi ảnh lỗi hẳn (sau khi đã thử lại), thì bỏ qua ảnh đó, ghi cảnh báo vào job (số ảnh bị bỏ), và vẫn nạp phần chữ.

### 7.5 Chia đoạn
- Theo cấu trúc: mỗi mục dưới một tiêu đề là một đơn vị. Mục quá dài thì cắt tiếp theo đoạn văn. Mục quá ngắn thì gộp với mục kế bên **trong cùng mục cha**.
- Độ dài mục tiêu khoảng 300–800 từ. Người làm tự chỉnh.
- Mỗi đoạn mang `heading_path`, `page_from/to` và tiêu đề tài liệu. **Chữ đem đi tạo embedding** = tiêu đề tài liệu + `heading_path` + nội dung, để đoạn tách ra vẫn còn ngữ cảnh.
- Khối bảng và khối ảnh là đoạn riêng, không trộn với văn bản.
- Bỏ header, footer và số trang lặp lại (Docling thường đã đánh dấu).
- Ngôn ngữ của đoạn xác định bằng heuristic (tỉ lệ ký tự có dấu tiếng Việt). Ngôn ngữ tài liệu = ngôn ngữ chiếm đa số, hoặc `mixed`.

### 7.6 Gắn nhãn: Tagger
- Interface `RagTagger` có hai bản: `JevTagger` (mặc định) và `GeminiTagger` (dự phòng). Chọn bằng `RAG_TAGGER=jev|gemini`.
- **Jev**: mỗi đoạn một request:
  - `domain`: câu hỏi `choice` với 3 lựa chọn (`guidelines`, `conditions`, `safety`).
  - Mỗi nhãn trong danh sách là một câu hỏi `noul` (0–1), dùng câu mô tả tiếng Anh của nhãn.
  - Giữ những nhãn có xác suất ≥ `RAG_TAG_THRESHOLD` (mặc định 0.5). Lưu toàn bộ xác suất vào `tag_scores`.
  - Lời gọi đã thử: `POST https://api.typesafe.ai/v1/systemone`, header `Authorization: Bearer <key>`, body `{ state, model: "jev-latest", questions: { <id>: { type: "choice", instructions, criteria: { option: description } } | { type: "noul", instructions } } }`. Câu trả lời nằm ở `answers.<id>`.
- **Gemini dự phòng**: một lời gọi trả về JSON nhãn, **chỉ được chọn từ danh sách** (lọc bỏ mọi giá trị lạ trước khi lưu). Gọi qua `OllamaService.chat`, tức là theo `LLM_PROVIDER` như phần còn lại của server.
- **Giới hạn của Jev**: chưa biết rate limit hay quota trong giai đoạn truy cập sớm. Gọi Jev **lần lượt từng đoạn** (không bắn song song), thử lại có backoff khi gặp 429 hoặc 5xx. Nếu Jev vẫn lỗi liên tục (ví dụ 3 đoạn liền nhau), job **chuyển sang `GeminiTagger` cho phần còn lại**, ghi tagger đã dùng vào `tag_scores` hoặc metadata của từng đoạn, và ghi cảnh báo vào job. Đoạn được gắn nhãn bằng dự phòng **không** tính là lỗi.
- Đoạn nào gắn nhãn lỗi (kể cả dự phòng cũng lỗi) thì job vẫn chạy tiếp. Đoạn đó có `tags` rỗng, `domain = guidelines`, và được đánh dấu để admin thấy. Nếu quá nửa số đoạn lỗi thì job thất bại.

### 7.7 Embedding
- Ollama `bge-m3` (`RAG_EMBEDDING_MODEL=bge-m3`, `RAG_EMBEDDING_DIM=1024`).
- **Không bỏ dấu, không lowercase.** Bỏ hàm `normalizeForEmbedding` ở luồng RAG.
- Không cắt cứng 2000 ký tự. Đoạn đã được giới hạn độ dài ở bước chia đoạn, và `bge-m3` nhận được tới 8192 token.
- **Truy vấn khi tìm cũng phải dùng `bge-m3`, cùng cách chuẩn hóa** (mục 9).

## 8. Sửa tay và nạp lại

- **Sửa nội dung** (PATCH chunk): lưu, đặt `is_manually_edited = true`, **tạo lại embedding** cho đoạn đó. Nhãn **không** tự gắn lại.
- **Sửa nhãn và domain**: chỉ được chọn giá trị trong danh sách (server kiểm tra). Đặt `is_manually_edited = true`.
- **Gắn nhãn lại** (nút "Re-tag with Jev"): chạy Tagger cho một đoạn rồi ghi đè nhãn. Admin chủ động bấm nên được phép ghi đè.
- **Bật/tắt** (`is_active`): không xóa đoạn.
- **Nạp lại tài liệu**: tạo đoạn mới và ghép với đoạn cũ theo `chunk_key`.
  - Đoạn chưa sửa tay: thay bằng bản mới (nếu `source_content_hash` không đổi thì giữ nguyên embedding và nhãn, khỏi gọi lại).
  - Đoạn đã sửa tay: **giữ nguyên**. Nếu `source_content_hash` mới khác bản cũ thì đặt `needs_review = true`.
  - Đoạn cũ không còn trong bản mới: chưa sửa tay thì xóa. Đã sửa tay thì giữ và đặt `needs_review = true`.
  - `chunk_key` nên ổn định khi tài liệu chỉ đổi chút ít, ví dụ hash của `heading_path`, `block_kind` và thứ tự trong mục đó. Cách tính cụ thể do người làm chọn.
- Mọi thay đổi (job xong, sửa, bật/tắt, xóa) đều kích hoạt **dựng lại index** của `RetrievalService` (mục 9). Gộp lại (debounce) nếu xảy ra liên tục.

## 9. Thay đổi tối thiểu phía tìm kiếm (để kho mới dùng được)

Chỉ những thay đổi sau. Phần còn lại để Dự án 2.

1. `VectorService`: model và số chiều embedding của RAG đọc từ cấu hình (`bge-m3`, 1024). Bỏ bỏ dấu và lowercase cho luồng RAG. `FoodSemanticSearchService` vẫn dùng model cũ cho `food_embeddings`, nên cần tách cấu hình model RAG và model food (ví dụ `RAG_EMBEDDING_MODEL` và `FOOD_EMBEDDING_MODEL`, mặc định `nomic-embed-text`).
2. Tắt việc tự tạo embedding lúc khởi động trong `RetrievalService.onModuleInit` (`POSTGRES_SYNC_EMBEDDINGS_ON_BOOT`). Từ giờ công cụ nạp lo embedding. Có thể giữ một lệnh "sửa embedding thiếu" cho admin, không bắt buộc.
3. `PostgresRagService.loadChunks`: chỉ lấy đoạn `is_active = true`. Đưa `tags`, `heading_path`, `page_from` và `link` vào `DomainDoc.metadata`.
4. `RetrievalService.rebuildIndex()` đã có. Gọi nó sau mỗi thay đổi kho (mục 8). Khi kho trống, retrieval phải trả về `[]` thay vì throw. Hiện `loadDomainData` throw lỗi khi không có tài liệu, và server phải khởi động được khi kho còn trống.
5. Kết quả trả về nên có `pageFrom` để sau này dẫn nguồn. Không bắt buộc ở dự án này.

## 10. Danh sách nhãn (taxonomy)

Một file duy nhất ở backend, ví dụ `src/rag-admin/rag-taxonomy.ts`, là **nguồn sự thật**. Admin-page lấy nó qua API, không tự chép lại.

Mỗi nhãn: `{ key, group, labelEn, labelVi, description }`. `description` bằng tiếng Anh, dùng làm câu hỏi cho Tagger.

- **conditions**: lấy từ `conditionOptions` trong `calorie-counter-web/src/features/onboarding/mapping.ts`: `hypertension`, `diabetes`, `heart_disease`, `kidney_disease`, `thyroid`, `high_cholesterol`.
- **goals**: lấy từ `goalOptions`: `weight_loss`, `maintenance`, `weight_gain`, `muscle_gain`, `modify_diet`, `plan_meals`, `manage_stress`, `stay_active`.
- **allergens**: lấy từ `allergyOptions`, chuyển sang `snake_case`: `peanuts`, `tree_nuts`, `milk_lactose`, `eggs`, `fish`, `shellfish`, `soy`, `wheat_gluten`, `sesame`. Backend đang lưu dị ứng dạng chữ tự do (`AppUser.Allergies`), nên file taxonomy cần thêm bảng ánh xạ từ nhãn hiển thị (`"Wheat or gluten"`) sang key, để Dự án 2 dùng.
- **nutrients**: các chất hệ thống đang theo dõi hoặc đặt ngưỡng (`UserNutritionalThreshold.Nutrient`, condition rules). Tối thiểu gồm `sodium`, `sugar`, `fiber`, `saturated_fat`, `cholesterol`, `potassium`, `protein`, `carbs`, `calories`. Người làm chốt danh sách theo giá trị thực trong DB và condition rules.
- **domain** (một giá trị): `guidelines`, `conditions`, `safety`.

Chưa kiểm tra app Flutter (`FE-calorie-counter`) có dùng cùng danh sách giá trị hay không. Người làm nên đối chiếu, và nếu khác thì ghi chú trong file taxonomy.

## 11. API admin (backend)

Module mới, ví dụ `src/admin/rag-documents/`, theo mẫu `admin-condition-rules`. Dùng `@UseGuards(AdminJwtAuthGuard, AdminRoleGuard)` và `@UseFilters(AdminAuthExceptionFilter)`.

| Method | Path | Việc |
|---|---|---|
| POST | `/admin/rag/documents/url` | `{ url }` → tạo tài liệu và job. URL trùng thì trả về tài liệu đang có |
| POST | `/admin/rag/documents/upload` | multipart, field `file` (PDF ≤ 50MB) → tạo tài liệu và job |
| GET | `/admin/rag/documents` | danh sách: `search`, `status`, `language`, `page`, `limit`. Kèm trạng thái job mới nhất |
| GET | `/admin/rag/documents/:id` | chi tiết, kèm job mới nhất (`stage`, `progress`, `error_message`) |
| PATCH | `/admin/rag/documents/:id` | sửa `title` |
| POST | `/admin/rag/documents/:id/reingest` | tạo job mới |
| DELETE | `/admin/rag/documents/:id` | xóa tài liệu, các đoạn, embedding và file |
| GET | `/admin/rag/documents/:id/chunks` | danh sách đoạn: lọc `blockKind`, `needsReview`, `isActive` |
| PATCH | `/admin/rag/chunks/:id` | `{ content?, domain?, tags?, isActive? }` |
| POST | `/admin/rag/chunks/:id/retag` | gắn nhãn lại bằng Tagger |
| POST | `/admin/rag/chunks/:id/resolve-review` | bỏ cờ `needs_review` |
| GET | `/admin/rag/chunks/:id/image` | trả về file ảnh của đoạn `image` |
| GET | `/admin/rag/taxonomy` | danh sách nhãn |

Lỗi trả về theo cách các module admin khác đang làm (file `*.exception.ts` + filter).

## 12. Trang quản trị (repo `Admin-page`)

- Module mới `src/modules/rag-documents/{api,hooks,pages,components,types}`, route `/admin/rag-documents` trong `AdminLayout`, thêm mục "Knowledge base" vào `Sidebar`.
- **Bố cục hai cột** (mockup B):
  - **Cột trái**: ô dán URL kèm nút thêm, nút tải PDF (dùng lại cách chọn file và thanh tiến trình của `FoodImportModal`), ô tìm kiếm, lọc theo trạng thái và ngôn ngữ, danh sách tài liệu (tiêu đề, nguồn, ngôn ngữ, số đoạn, trạng thái). Tài liệu lỗi hiện lý do và nút "Retry".
  - **Cột phải**: tài liệu đang chọn (tiêu đề sửa được, link gốc, nút Re-ingest và Delete có xác nhận) và danh sách đoạn. Mỗi đoạn hiện `heading_path`, trang, loại (text/table/image), nhãn dạng chip, và các badge "edited", "needs review", "inactive".
  - **Khung sửa đoạn** (mở khi bấm vào một đoạn): sửa nội dung, sửa nhãn bằng chip (thêm từ danh sách sổ xuống lấy từ taxonomy, bỏ bằng ✕), chọn domain, bật/tắt, nút Save, Re-tag with Jev, và Mark reviewed khi đoạn có cờ cần xem lại. **Đoạn loại `image` hiện ảnh gốc bên cạnh** để so số liệu.
- Khi có tài liệu đang `pending` hoặc `processing`, cứ 3 giây hỏi lại trạng thái một lần (polling) và hiện `stage` kèm %.
- Lọc nhanh "Needs review" để admin tìm các đoạn cần xem.
- Có trạng thái loading, rỗng và lỗi như các trang khác.

## 13. Cấu hình (`.env.example`)

```
TYPESAFE_API_KEY=
TYPESAFE_API_URL=https://api.typesafe.ai/v1
JEV_MODEL=jev-latest
RAG_TAGGER=jev            # jev | gemini
RAG_TAG_THRESHOLD=0.5
DOCLING_URL=http://localhost:5001
RAG_STORAGE_DIR=./storage/rag
RAG_EMBEDDING_MODEL=bge-m3
RAG_EMBEDDING_DIM=1024
FOOD_EMBEDDING_MODEL=nomic-embed-text
GEMINI_VISION_MODEL=      # trống = dùng GEMINI_MODEL
RAG_INGEST_POLL_MS=5000
RAG_MAX_PDF_PAGES=300
POSTGRES_SYNC_EMBEDDINGS_ON_BOOT=false
```

Cần `ollama pull bge-m3`.

**Triển khai:** repo hiện chỉ có `Dockerfile` và CI đẩy image lên GHCR, chưa có compose. Dự án này **thêm một `docker-compose.rag.yml`** gồm service `docling-serve` (giới hạn bộ nhớ, 1 worker) và volume cho `RAG_STORAGE_DIR`, cộng thêm một mục trong README hướng dẫn chạy. Cách triển khai production hiện tại không đổi ngoài những thứ này.

## 14. Cách biết là xong và đúng

- Nạp từ đầu đến cuối thành công: (a) một trang web tiếng Anh (ví dụ WHO "Healthy diet" fact sheet), (b) một PDF tiếng Việt có bảng và infographic.
- **Bảng**: chọn ngẫu nhiên 10 dòng bảng trong PDF thử, số trong đoạn phải **trùng khớp** với PDF.
- **Ảnh**: đoạn lấy từ infographic có đúng các số trong ảnh. Ảnh logo hoặc trang trí không tạo ra đoạn nào.
- **Nhãn**: xem bằng mắt khoảng 30 đoạn, nhãn hợp lý. Đặc biệt, đoạn nói về cả bệnh lẫn dị ứng phải có nhãn của cả hai.
- **Sửa tay**: sửa một đoạn, gọi `/rag/evaluate` (hoặc tạo món) và thấy nội dung mới **mà không cần khởi động lại server**. Nạp lại tài liệu thì đoạn đã sửa vẫn còn.
- **Tắt đoạn**: đoạn bị tắt không còn xuất hiện trong kết quả tìm.
- Trong lúc một job đang chạy, Recipe Builder và Dashboard AI vẫn trả lời bình thường.
- Server khởi động được khi kho trống.
- Test đơn vị cho: chuyển bảng thành câu, chia đoạn, ghép đoạn khi nạp lại (giữ đoạn sửa tay, đặt `needs_review`), lọc nhãn ngoài danh sách, worker nhận job (không nhận trùng, đưa job `running` về lại khi khởi động).

## 15. Để lại cho người làm

- Phiên bản và API cụ thể của `docling-serve` (endpoint convert, tùy chọn tắt OCR, trích ảnh, định dạng trả về), và việc chia đoạn dùng chunker của Docling hay tự làm từ cấu trúc nó trả về.
- Ngưỡng độ dài đoạn, ngưỡng kích thước ảnh, `RAG_TAG_THRESHOLD`.
- Câu chữ của các câu hỏi gửi Jev và prompt gửi Gemini.
- Cách tính `chunk_key`.
- Danh sách `nutrients` cuối cùng.
- Đặt cột mới thành cột riêng hay để trong `metadata`, miễn code retrieval hiện tại vẫn đọc được `domain`.
- Tên module và tên file cụ thể.
