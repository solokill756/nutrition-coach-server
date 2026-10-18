# Kho tài liệu RAG — Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm trang "Knowledge base" vào Admin-page để admin thêm tài liệu (URL/PDF), theo dõi job nạp, xem và sửa từng đoạn (nội dung, nhãn, domain, bật/tắt), kèm ảnh gốc cho đoạn lấy từ ảnh.

**Architecture:** Module mới `src/modules/rag-documents/` theo đúng khuôn các module có sẵn (`api / hooks / pages / components / types`). Bố cục hai cột: danh sách tài liệu ở bên trái, chi tiết tài liệu và các đoạn ở bên phải, khung sửa đoạn mở ngay tại chỗ. Logic thuần (trạng thái job, bản nháp sửa đoạn) tách ra file riêng và có test Vitest.

**Tech Stack:** React 19, Vite 7, react-router-dom 7, lucide-react, TypeScript, CSS tự viết (`src/styles.css`). Thêm Vitest chỉ để test hàm thuần.

**Spec:** `nutrition-coach-server/docs/superpowers/specs/2026-10-18-rag-knowledge-base-design.md` (mục 12). Hợp đồng API nằm ở **Task 12** của `nutrition-coach-server/docs/superpowers/plans/2026-10-18-rag-knowledge-base-backend.md`, và plan này dùng đúng các tên ở đó.

**Repo:** https://github.com/solokill756/Admin-page (nhánh `main`), clone về trước khi làm. Plan này đang được lưu trong repo server vì Admin-page chưa có ở máy. Khi làm thì chép file sang `docs/superpowers/plans/` của Admin-page.

## Global Constraints

- Chữ trên giao diện bằng **tiếng Anh**, giọng văn giống các trang hiện có.
- Không thêm thư viện UI. Icon dùng `lucide-react`. CSS thêm vào `src/styles.css` và dùng lại các class có sẵn (`page-heading`, `section-kicker`, `primary-button`, `secondary-button`, `danger-button`, `modal-backdrop`, `confirm-dialog`, `state-copy`, `dashboard-error`, `upload-box`, `progress-bar-bg`/`progress-bar-fill`).
- Gọi API qua `adminRequest` trong `src/shared/api/httpClient.ts`. Thông báo dùng `useToast().showToast(message, "success" | "error")`.
- Route: `/admin/rag-documents`. Sidebar: label `"Knowledge base"`, icon `BookOpen`.
- PDF tải lên: chỉ `.pdf`, tối đa **50MB**. Kiểm tra ở client trước khi gửi, server vẫn kiểm tra lại.
- Hỏi lại trạng thái (polling) mỗi **3 giây** khi còn tài liệu `pending` hoặc `processing`.
- Lệnh kiểm tra: `npm run build` (gồm `tsc -b`) và `npx vitest run`.

## Review Focus

1. **Polling làm mất bản sửa chưa lưu.** Trong lúc admin đang gõ trong khung sửa đoạn, mỗi lần polling hoặc tải lại danh sách đoạn không được ghi đè bản nháp. Test nằm ở Task 1 (`reconcileDraft`).
2. **Polling chạy mãi.** Polling phải dừng khi không còn tài liệu nào đang xử lý, và khi rời khỏi trang. Test nằm ở Task 1 (`hasActiveIngest`), cleanup nằm ở Task 2.
3. **Chuyển sang tài liệu hoặc đoạn khác khi đang có bản sửa chưa lưu.** Phải hỏi xác nhận trước khi bỏ bản sửa. Thực hiện ở Task 4.
4. **Tải lên PDF lớn.** Nút phải bị khóa và hiện trạng thái "Uploading…" để tránh bấm hai lần. File không phải PDF hoặc lớn hơn 50MB thì báo ngay, không gửi đi. Test nằm ở Task 1 (`validatePdfFile`).
5. **Ảnh của đoạn `image` bị rò bộ nhớ.** Ảnh được tải bằng fetch có token rồi tạo object URL. URL này phải `revokeObjectURL` khi đổi đoạn hoặc khi đóng khung sửa. Thực hiện ở Task 4.

---

## Cấu trúc file

```
src/modules/rag-documents/
  types/adminRag.types.ts
  api/adminRagApi.ts
  lib/ragStatus.ts          (+ ragStatus.test.ts)
  lib/chunkDraft.ts         (+ chunkDraft.test.ts)
  lib/ragErrors.ts
  hooks/useRagDocuments.ts
  hooks/useRagChunks.ts
  hooks/useRagTaxonomy.ts
  pages/AdminRagDocumentsPage.tsx
  components/AddDocumentBar.tsx
  components/DocumentList.tsx
  components/DocumentDetail.tsx
  components/ChunkList.tsx
  components/ChunkEditor.tsx
  components/TagChips.tsx
  components/ChunkImage.tsx
```

Sửa: `src/shared/api/httpClient.ts`, `src/app/router.tsx`, `src/shared/components/Sidebar.tsx`, `src/styles.css`, `package.json`.

---

### Task 1: Kiểu dữ liệu, API client, hàm thuần và Vitest

**Files:**
- Modify: `src/shared/api/httpClient.ts`, `package.json` (devDependency `vitest`, script `"test": "vitest run"`)
- Create: `src/modules/rag-documents/types/adminRag.types.ts`, `api/adminRagApi.ts`, `lib/ragStatus.ts`, `lib/chunkDraft.ts`, `lib/ragErrors.ts`
- Test: `src/modules/rag-documents/lib/ragStatus.test.ts`, `lib/chunkDraft.test.ts`

**Interfaces:**
- `httpClient.ts`:
  - `adminRequest` **không** đặt `Content-Type: application/json` khi `options.body instanceof FormData`.
  - Thêm `adminRequestBlob(path: string): Promise<Blob>`: cùng header Authorization và cùng cách xử lý lỗi/401 như `adminRequest`, nhưng trả về `response.blob()`.
- `adminRag.types.ts`: `RagJob`, `RagDocument`, `RagChunk`, `RagTags`, `RagTagGroup`, `RagDomain`, `RagTaxonomyItem`, `RagTaxonomy`. Các trường **giống hệt** `RagJobDto`, `RagDocumentDto`, `RagChunkDto`, `RagTaxonomyDto` ở Task 12 của plan backend. Thêm:
  - `RagDocumentListQuery = { page?: number; limit?: number; search?: string; status?: RagDocument["status"]; language?: "en" | "vi" | "mixed" }`
  - `RagChunkFilter = { blockKind?: RagChunk["blockKind"]; needsReview?: boolean; isActive?: boolean }`
  - `UpdateRagChunkPayload = { content?: string; domain?: RagDomain; tags?: RagTags; isActive?: boolean }`
  - Các kiểu response: `{ success: true; data: … }`. Danh sách có thêm `pagination: { page; limit; total; totalPages }`. Thêm/tải lên có thêm `created: boolean`.
- `adminRagApi`:
  - `listDocuments(q)`, `getDocument(id)`, `addUrl(url)`, `uploadPdf(file: File)` (FormData, field `"file"`), `renameDocument(id, title)`, `reingest(id)`, `deleteDocument(id)`
  - `listChunks(documentId, filter)`, `updateChunk(id, payload)`, `retagChunk(id)`, `resolveReview(id)`
  - `getChunkImage(id): Promise<Blob>`, `getTaxonomy()`
  - Đường dẫn đúng như bảng ở Task 12 backend.
- `lib/ragStatus.ts`:
  - `hasActiveIngest(docs: RagDocument[]): boolean`: true khi có tài liệu `pending` hoặc `processing`.
  - `documentStatusLabel(doc: RagDocument): string`. Các dạng:
    - `"Queued"`
    - `"Processing · <stage> <progress>%"` (ví dụ `"Processing · tagging 62%"`)
    - `"Ready · <n> chunks"`
    - `"Failed: <errorMessage>"`, hoặc `"Failed"` nếu không có thông báo
  - `validatePdfFile(file: { name: string; type: string; size: number }): string | null`: trả về thông báo lỗi hoặc `null`. Chấp nhận `type === "application/pdf"` hoặc tên kết thúc bằng `.pdf`. Giới hạn 50MB.
- `lib/chunkDraft.ts`:
  - `type ChunkDraft = { chunkId: string; content: string; domain: RagDomain; tags: RagTags; isActive: boolean }`
  - `createDraft(chunk: RagChunk): ChunkDraft`
  - `isDraftDirty(draft: ChunkDraft, chunk: RagChunk): boolean`: so sánh tags theo tập hợp, không phụ thuộc thứ tự.
  - `draftToPatch(draft: ChunkDraft, chunk: RagChunk): UpdateRagChunkPayload`: chỉ gồm các trường đã đổi.
  - `reconcileDraft(draft: ChunkDraft | null, refreshed: RagChunk, previous: RagChunk): ChunkDraft`: nếu bản nháp đang có thay đổi so với `previous` thì **giữ bản nháp**, nếu không thì `createDraft(refreshed)`.
- `lib/ragErrors.ts`: `messageForRagError(error: unknown, fallback: string): string`, dùng bảng mã lỗi của Task 12 backend cộng với các mã chung (`UNAUTHORIZED`, `NETWORK_ERROR`, …) như trong `AdminFoodsPage`. Ví dụ `RAG_JOB_IN_PROGRESS` → "This document is already being processed".

- [ ] **Step 1: Cài Vitest** — `npm i -D vitest`, thêm script `"test": "vitest run"`.
- [ ] **Step 2: Viết test lỗi**

```ts
// ragStatus.test.ts
it("hasActiveIngest is true only for pending/processing", () => {
  expect(hasActiveIngest([doc({ status: "ready" }), doc({ status: "failed" })])).toBe(false);
  expect(hasActiveIngest([doc({ status: "ready" }), doc({ status: "processing" })])).toBe(true);
});
it("documentStatusLabel", () => {
  expect(documentStatusLabel(doc({ status: "processing", latestJob: job({ stage: "tagging", progress: 62 }) })))
    .toBe("Processing · tagging 62%");
  expect(documentStatusLabel(doc({ status: "ready", chunkCount: 14 }))).toBe("Ready · 14 chunks");
  expect(documentStatusLabel(doc({ status: "failed", latestJob: job({ errorMessage: "Could not download the page (blocked or not found)" }) })))
    .toBe("Failed: Could not download the page (blocked or not found)");
});
it("validatePdfFile", () => {
  expect(validatePdfFile({ name: "a.pdf", type: "application/pdf", size: 1000 })).toBeNull();
  expect(validatePdfFile({ name: "a.docx", type: "application/msword", size: 1000 })).toMatch(/PDF/);
  expect(validatePdfFile({ name: "a.pdf", type: "application/pdf", size: 51 * 1024 * 1024 })).toMatch(/50 MB/);
});

// chunkDraft.test.ts
it("draftToPatch includes only changed fields", () => {
  const c = chunk({ content: "a", tags: { conditions: ["diabetes"], allergens: [], goals: [], nutrients: [] } });
  const d = { ...createDraft(c), isActive: false };
  expect(draftToPatch(d, c)).toEqual({ isActive: false });
});
it("isDraftDirty ignores tag order", () => {
  const c = chunk({ tags: { conditions: ["diabetes", "hypertension"], allergens: [], goals: [], nutrients: [] } });
  expect(isDraftDirty({ ...createDraft(c), tags: { ...c.tags, conditions: ["hypertension", "diabetes"] } }, c)).toBe(false);
});
it("reconcileDraft keeps unsaved edits when the chunk list refreshes", () => {
  const prev = chunk({ content: "old" });
  const draft = { ...createDraft(prev), content: "typing…" };
  expect(reconcileDraft(draft, chunk({ content: "old", updatedAt: "later" }), prev).content).toBe("typing…");
});
it("reconcileDraft takes the refreshed chunk when there are no edits", () => {
  const prev = chunk({ content: "old" });
  expect(reconcileDraft(createDraft(prev), chunk({ content: "retagged" }), prev).content).toBe("retagged");
});
```

- [ ] **Step 3: Chạy test, thấy lỗi** — `npx vitest run src/modules/rag-documents`.
- [ ] **Step 4: Viết code** cho types, api, lib và sửa `httpClient`.
- [ ] **Step 5: Chạy test, thấy pass**, rồi chạy `npm run build`.
- [ ] **Step 6: Commit** — `git commit -m "feat(rag-documents): types, API client and draft/status helpers"`

---

### Task 2: Trang, route, sidebar và cột danh sách tài liệu

**Files:**
- Create: `hooks/useRagDocuments.ts`, `pages/AdminRagDocumentsPage.tsx`, `components/AddDocumentBar.tsx`, `components/DocumentList.tsx`
- Modify: `src/app/router.tsx`, `src/shared/components/Sidebar.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `adminRagApi`, `hasActiveIngest`, `documentStatusLabel`, `validatePdfFile`, `messageForRagError` (Task 1).
- Produces:
  - `useRagDocuments()` trả về:
    - Dữ liệu: `{ documents, pagination, query, isLoading, errorCode, selectedId }`
    - Thao tác: `setSelectedId, updateQuery, addUrl(url): Promise<{ created: boolean; document: RagDocument }>, uploadPdf(file): Promise<…cùng kiểu>, reingest(id), deleteDocument(id), renameDocument(id, title), refresh() }`
    - Search được debounce 350ms như `useAdminFoods`.
    - Polling: khi `hasActiveIngest(documents)` thì đặt `setTimeout` 3000ms để gọi lại `listDocuments` (giữ nguyên query hiện tại). Dừng khi không còn tài liệu đang xử lý. Hủy timeout trong cleanup của `useEffect` khi unmount.
  - `AdminRagDocumentsPage`: phần đầu trang (`section-kicker` "Retrieval", tiêu đề "Knowledge base", mô tả một dòng). Bên dưới là lưới hai cột: `.rag-layout > .rag-list-column + .rag-detail-column`. Màn hình hẹp hơn 960px thì xếp thành một cột.
  - `AddDocumentBar`:
    - Ô nhập URL kèm nút "Add URL". Nút "Upload PDF" mở `input[type=file][accept=".pdf,application/pdf"]`.
    - Đang gửi thì khóa cả hai nút và hiện "Uploading…" hoặc "Adding…".
    - `created:false` thì toast "This document is already in the knowledge base" và chọn luôn tài liệu đó.
    - `created:true` thì toast "Document queued for processing" và chọn tài liệu mới.
  - `DocumentList`:
    - Ô tìm kiếm, ô chọn Status (All / Queued / Processing / Ready / Failed), ô chọn Language (All / EN / VI / Mixed).
    - Mỗi dòng có: tiêu đề, nguồn (icon `Globe` kèm hostname, hoặc icon `FileText` kèm tên file), nhãn ngôn ngữ, và `documentStatusLabel`.
    - Tài liệu đang xử lý có thanh tiến trình. Tài liệu lỗi có nút "Retry" (gọi `reingest`).
    - Dòng đang chọn được tô nổi bật.
    - Có phân trang Previous/Next như trang Foods, cùng trạng thái loading, rỗng và lỗi.
  - Route `/admin/rag-documents`. Sidebar có mục `{ label: "Knowledge base", path: "/admin/rag-documents", icon: BookOpen }`.

- [ ] **Step 1: Viết code** (không có test tự động cho component; logic đã được test ở Task 1).
- [ ] **Step 2: `npm run build`**, mong đợi không có lỗi TypeScript.
- [ ] **Step 3: Kiểm tra bằng tay** với backend local (`VITE_API_BASE_URL`):
  - Thêm URL WHO: tài liệu hiện "Queued", rồi "Processing · … %" tự cập nhật, rồi "Ready · n chunks".
  - Mở DevTools → Network: khi không còn tài liệu đang xử lý thì không còn request polling. Rời trang khi đang có tài liệu xử lý cũng không còn request.
  - Dán lại cùng URL đó có thêm `/` ở cuối: hiện toast "already in the knowledge base".
  - Chọn file `.docx`: hiện thông báo lỗi ngay, Network không có request nào.
  - Tài liệu lỗi có nút Retry, bấm thì chuyển sang "Queued".
- [ ] **Step 4: Commit** — `git commit -m "feat(rag-documents): knowledge base page with document list and polling"`

---

### Task 3: Cột chi tiết tài liệu và danh sách đoạn

**Files:**
- Create: `hooks/useRagChunks.ts`, `hooks/useRagTaxonomy.ts`, `components/DocumentDetail.tsx`, `components/ChunkList.tsx`
- Modify: `pages/AdminRagDocumentsPage.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `useRagDocuments` (Task 2), `adminRagApi.listChunks`, `adminRagApi.getTaxonomy`.
- Produces:
  - `useRagTaxonomy(): { taxonomy: RagTaxonomy | null; isLoading: boolean; errorCode: string | null }`: tải một lần cho mỗi lần mở trang.
  - `useRagChunks(documentId: string | null)` trả về:
    - Dữ liệu: `{ chunks, filter, isLoading, errorCode, selectedChunkId }`
    - Thao tác: `setFilter, setSelectedChunkId, replaceChunk(chunk: RagChunk), refresh() }`
    - Tự tải lại khi `documentId` hoặc `filter` đổi, và khi trạng thái tài liệu chuyển sang `ready`. Page truyền `document.status` vào để hook biết lúc nào cần tải lại.
  - `DocumentDetail`:
    - Tiêu đề sửa ngay tại chỗ (bấm vào để sửa, Enter để lưu, Esc để hủy).
    - Link gốc mở tab mới, hoặc tên file PDF.
    - Nhãn ngôn ngữ, số đoạn, cảnh báo của job mới nhất (`latestJob.warnings`, hiện dạng danh sách nhỏ).
    - Nút "Re-ingest" (toast lỗi khi gặp `RAG_JOB_IN_PROGRESS`) và nút "Delete" có hộp xác nhận "Delete this document? All its chunks and images will be removed from the knowledge base."
    - Chưa chọn tài liệu nào thì hiện "Select a document to see its chunks."
  - `ChunkList`:
    - Bộ lọc nhanh: All / Text / Table / Image, công tắc "Needs review", công tắc "Inactive only".
    - Mỗi thẻ đoạn hiện:
      - `headingPath` (hoặc "—"), trang (`p. 3–4`), icon loại đoạn
      - Nhãn dạng chip: chỉ đọc, hiện `labelEn` lấy từ taxonomy
      - 3 dòng đầu của nội dung
      - Badge `Edited` / `Needs review` / `Inactive` / `Tagging failed`
    - Bấm vào thẻ thì `setSelectedChunkId`.

- [ ] **Step 1: Viết code.**
- [ ] **Step 2: `npm run build`.**
- [ ] **Step 3: Kiểm tra bằng tay:**
  - Chọn tài liệu PDF: thấy các đoạn kèm trang, lọc "Table" chỉ còn đoạn bảng.
  - Đổi tiêu đề rồi tải lại trang: tiêu đề mới vẫn còn.
  - Delete có xác nhận: tài liệu biến mất khỏi danh sách.
  - Re-ingest hai lần liên tiếp: lần hai hiện toast "already being processed".
- [ ] **Step 4: Commit** — `git commit -m "feat(rag-documents): document detail and chunk list"`

---

### Task 4: Khung sửa đoạn

**Files:**
- Create: `components/ChunkEditor.tsx`, `components/TagChips.tsx`, `components/ChunkImage.tsx`
- Modify: `components/ChunkList.tsx` (mở editor ngay tại chỗ dưới thẻ đang chọn), `pages/AdminRagDocumentsPage.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `createDraft`, `isDraftDirty`, `draftToPatch`, `reconcileDraft` (Task 1), `useRagChunks.replaceChunk` (Task 3), `adminRagApi.updateChunk/retagChunk/resolveReview/getChunkImage`, `useRagTaxonomy`.
- Produces:
  - `ChunkEditor({ chunk, taxonomy, onSaved(chunk), onDirtyChange(dirty: boolean) })`
    - Giữ `draft` trong state. Khi prop `chunk` đổi nhưng **vẫn cùng id** thì cập nhật bằng `reconcileDraft(draft, chunk, previousChunk)` (Review Focus 1).
    - Bố cục:
      - Đoạn `image` thì `ChunkImage` nằm bên trái (khoảng 38%), phần sửa bên phải. Các loại đoạn khác thì phần sửa chiếm hết chiều ngang.
      - `textarea` cho nội dung.
      - Ô chọn domain lấy từ `taxonomy.domains`.
      - `TagChips` cho từng nhóm (Conditions / Allergens / Goals / Nutrients).
      - Radio "Used in RAG" / "Disabled".
    - Nút:
      - **Save**: khóa khi `!isDraftDirty`. Gửi `updateChunk(id, draftToPatch(...))`, xong thì `onSaved` và toast "Chunk saved".
      - **Re-tag with Jev**: nếu đang có bản sửa thì hỏi xác nhận "Discard unsaved changes and re-tag?". Gọi `retagChunk`, xong thì toast "Tags updated". Lỗi `RAG_TAGGING_FAILED` thì toast lỗi.
      - **Mark reviewed**: chỉ hiện khi `needsReview`. Gọi `resolveReview`.
    - Dòng ghi chú khi `isManuallyEdited`: "Edited by an admin · re-ingesting this document will not overwrite this chunk".
    - Khi `tagFailed`: "Automatic tagging failed for this chunk — add tags manually or re-tag".
  - `TagChips({ group, items: RagTaxonomyItem[], value: string[], onChange(next: string[]) })`: mỗi chip hiện `labelEn` (tooltip là `labelVi`) kèm nút ✕. Có nút "+ Add" mở danh sách các item chưa chọn. Không có ô nhập tự do.
  - `ChunkImage({ chunkId })`: gọi `getChunkImage`, rồi `URL.createObjectURL`. Cleanup bằng `URL.revokeObjectURL` khi `chunkId` đổi hoặc unmount (Review Focus 5). Lỗi thì hiện "Image unavailable".
  - Ở page: khi đổi đoạn đang chọn hoặc đổi tài liệu mà editor đang có bản sửa (`onDirtyChange`), dùng `window.confirm("Discard unsaved changes?")`. Nếu admin chọn hủy thì giữ nguyên lựa chọn cũ (Review Focus 3).

- [ ] **Step 1: Viết code.**
- [ ] **Step 2: `npx vitest run` và `npm run build`.**
- [ ] **Step 3: Kiểm tra bằng tay** (theo spec §14):
  - Sửa một con số trong đoạn `image`, so với ảnh hiện bên trái, bấm Save. Badge `Edited` xuất hiện. Gọi `GET /rag/evaluate?q=<từ mới>&mode=bm25-only` thì thấy nội dung mới mà không cần khởi động lại server.
  - Thêm nhãn `Shellfish` rồi bỏ nhãn `Diabetes`, Save. Tải lại trang: nhãn vẫn đúng như vừa sửa.
  - Đang gõ dở trong editor thì một tài liệu khác chạy xong (polling cập nhật): chữ đang gõ không bị mất.
  - Đang có bản sửa mà bấm sang đoạn khác: hiện hộp xác nhận. Bấm Cancel thì vẫn ở đoạn cũ.
  - Chuyển qua lại giữa 5 đoạn ảnh: trong DevTools → Memory hoặc Network không thấy blob URL cũ còn được giữ (có thể kiểm tra bằng cách đặt `console.count` tạm trong cleanup).
  - Chuyển sang "Disabled" rồi Save: badge `Inactive` hiện ra, và `/rag/evaluate` không còn trả về đoạn đó.
  - Nạp lại tài liệu: đoạn đã sửa vẫn giữ nội dung. Đoạn có bản gốc thay đổi hiện badge `Needs review`, bấm Mark reviewed thì badge biến mất.
- [ ] **Step 4: Commit** — `git commit -m "feat(rag-documents): chunk editor with tags, image preview and review"`
