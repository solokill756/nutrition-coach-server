# Đồng bộ context gửi LLM và lọc nguyên liệu an toàn — Thiết kế

Ngày: 2026-10-24
Repo: `nutrition-coach-server` (nhánh gốc: `master`)

## 1. Bối cảnh và lý do

Ba tính năng gửi thông tin người dùng cho LLM, nhưng mỗi tính năng tự lấy và tự chọn trường:

| | Dashboard AI | Recipe Builder | Staple allocation |
|---|---|---|---|
| Nguồn dữ liệu | Tự query trong `dashboard.service.ts` | `UserContextService` | `UserContextService` |
| Tuổi | Luôn `null` (query `select` thiếu `age`, `dashboard.service.ts` ~dòng 374) | Có | Không |
| Cân nặng / cân nặng mục tiêu | Có | Không | Không |
| Mục tiêu | 1 goal, sắp theo `startDate DESC` | Tất cả goal đang bật, sắp theo `id DESC` | Không |
| Ngưỡng dinh dưỡng | Chỉ ngưỡng theo bệnh lý | Ngưỡng cá nhân + theo bệnh lý | Chỉ theo bệnh lý, dạng object thô |
| RAG | top 4, không lọc điểm, 4000 ký tự | `TOP_K` (=6 trong `.env`), lọc `score >= 0.6`, 8000 ký tự | Không có |
| JSON | gọn | gọn | thụt lề |

Hậu quả: cùng một người dùng nhưng LLM ở mỗi tính năng "biết" những điều khác nhau. Có lỗi thật (Dashboard mất tuổi). Hai tính năng có thể dựa vào hai mục tiêu khác nhau. Logic tính ngưỡng theo bệnh lý bị viết lặp ở Dashboard.

Ngoài ra, bước chia nguyên liệu (Staple allocation) của Fridge planner **không có bảo vệ sức khỏe bằng code**:
- `validateAllocations` chỉ kiểm tra cấu trúc (id hợp lệ, 2–4 món mỗi bữa, không trùng nhiều).
- Luật dự phòng `pickFoodsForSlotWithExclude` (khi LLM lỗi) chọn theo protein / carbs / chất xơ / kcal, không xét dị ứng hay bệnh lý.
- Prompt Recipe Builder bắt buộc dùng **mọi** nguyên liệu được giao, nên một món sai ở bước chia sẽ đi thẳng vào công thức.

`UserContextService` cache phần tĩnh 5 phút. Cache hiện chỉ bị xóa khi đổi `mealSplits` (`auth.service.ts`) và khi admin đổi condition rule. Người dùng thêm dị ứng xong thì Recipe Builder có thể vẫn dùng dữ liệu cũ tới 5 phút.

## 2. Mục tiêu

1. Cả 3 tính năng gửi cho LLM **cùng một khối hồ sơ người dùng**: cùng nguồn, cùng trường, cùng định dạng (JSON gọn), cùng quy tắc chọn dữ liệu.
2. Cả 3 tính năng dùng **cùng cấu hình RAG**: cùng số tài liệu lấy về, cùng ngưỡng lọc điểm, cùng giới hạn ký tự, khai báo ở một chỗ.
3. Staple allocation có RAG. Trong một lần chạy Fridge planner, RAG chỉ tìm **một lần** và dùng lại cho bước chia nguyên liệu lẫn mọi bữa của Recipe Builder.
4. Fridge planner **tự loại** nguyên liệu gây dị ứng hoặc vượt ngưỡng bệnh lý trước khi chia, áp dụng cho cả nhánh LLM lẫn nhánh dự phòng.
5. Recipe Builder chạy riêng lẻ: nguyên liệu người dùng tự chọn mà gây dị ứng thì **vẫn cho dùng nhưng hiện cảnh báo**.
6. Sửa hồ sơ, dị ứng, bệnh lý, mục tiêu hay ngưỡng dinh dưỡng thì context LLM cập nhật ngay, không chờ cache hết hạn.

## 3. Không làm (non-goals)

- Không thêm cột dị ứng vào bảng `food_nutrition`. Lọc dị ứng dùng từ khóa theo tên món. Thêm cột là việc sau.
- Không đổi các lượt gọi LLM không dùng thông tin người dùng: ước lượng dinh dưỡng, dịch tên món, viết lại truy vấn, rerank, gắn tag chunk, vision.
- Không đổi thuật toán retrieval, chunking hay tagging.
- Không đổi giao diện frontend. Cảnh báo mới đi qua các trường đã có (`safetyWarnings`, `generationWarnings`, warnings của slot Fridge).
- Không đổi con số hiển thị trên Dashboard (target kcal, macro...), trừ hệ quả của việc thống nhất cách chọn goal (mục 4.1).

## 4. Phạm vi và cách làm (các quyết định đã chốt)

### 4.1 Khối hồ sơ người dùng dùng chung

- **Nguồn duy nhất:** `UserContextService`. Dashboard AI không tự query user, goal, bệnh lý, condition rule để dựng context LLM nữa.
- **Một hàm chung** dựng khối hồ sơ cho prompt, ví dụ `buildLlmUserProfile(ctx)` đặt cạnh `UserContextService`. Cả 3 tính năng gọi hàm này và nhúng kết quả bằng `JSON.stringify` (không thụt lề).
- **Các trường của khối chung:**
  - `age`, `sex`, `heightCm`, `weightKg`, `goalWeightKg`, `dietType`, `allergies`, `fitnessLevel`
  - `goals`: tất cả goal type đang bật
  - `healthConditions`: tên bệnh lý đang bật
  - `nutrientLimits`: ngưỡng cá nhân + ngưỡng theo bệnh lý, định dạng bằng `formatThresholdMinMax`, bỏ trùng (giống `toPromptProfile` hiện tại của Recipe Builder)
  - `today`: tổng các chất đã ăn hôm nay (`DayIntakeTotals`) và lượng còn lại **của các chất có ngưỡng** (sodium, carbs, fat, sugars...). **Không** chứa target kcal hay kcal còn lại (xem dưới).
- **Kcal target và kcal còn lại thuộc phần riêng của từng tính năng** (quyết định của Claude). Lý do: Dashboard tính `remaining = target − (consumed − burned)`, có trừ vận động, và fallback `DEFAULT_CAL_TARGET`. `UserContextService` tính `dailyTargetCalories − intake`, không trừ vận động. Nếu đưa vào khối chung, prompt Dashboard sẽ có hai con số "kcal còn lại" mâu thuẫn. Giữ riêng thì các con số Dashboard đang hiển thị không đổi.
- **Phần riêng của từng tính năng** vẫn giữ, đặt ngoài khối chung:
  - Dashboard: nước, vận động, cảnh báo dinh dưỡng, calories/macros target và kcal còn lại (tính như hiện tại)
  - Recipe Builder: nguyên liệu, budget lines của bữa, `recentRecipes`, constraints
  - Staple allocation: nguyên liệu, `slotTargets`, `alreadyAllocated`, `regenerateSlot`
- **Quyết định của Claude, cần kiểm tra:**
  - `weightKg` lấy theo log cân nặng mới nhất, nếu không có thì dùng `user.weight`, như Dashboard đang làm.
  - Thống nhất chọn goal: sắp theo `startDate DESC, id DESC` ở cả `UserContextService` và Dashboard. Dashboard đã sắp theo `startDate DESC` nên con số hiển thị không đổi; chỉ thứ tự của `UserContextService` thay đổi.
  - `dailyTargetCalories` vẫn là goal đầu tiên có `targetCalories > 0` theo thứ tự này.
- Sửa lỗi Dashboard mất `age` như một phần tự nhiên của việc chuyển sang `UserContextService`.

### 4.2 Cấu hình RAG dùng chung

- Khai báo **một chỗ** (ví dụ `src/retrieval/rag-prompt-config.ts`):
  - Số tài liệu lấy về: đọc `TOP_K`, mặc định **6**
  - Ngưỡng lọc: `RAG_CONFIDENCE_THRESHOLD` (**0.6**, đã có trong `rag-confidence.ts`)
  - Giới hạn ký tự phần tham khảo: **6000** (thay 4000 của Dashboard và 8000 của Recipe)
- Một hàm chung, ví dụ `retrieveUserReferences(ctx, purpose)`: dựng truy vấn bằng `buildPersonalizedRagQuery` → `retrieve` → lọc điểm → `buildRagReferenceBlock`. Trả về `{ text, used }`.
- Dashboard bỏ `retrieve(question, 4, ...)` và hằng `AI_SUGGESTION_REFERENCE_MAX_CHARS`. Recipe bỏ `RECIPE_REFERENCE_MAX_CHARS`.
- **Quyết định của Claude:** giữ tham số `purpose` (`dashboard_suggestion` / `recipe_generation`) trong truy vấn. Phần này chỉ đổi vài từ khóa và `intent` cho đúng việc của từng tính năng; cấu hình số lượng, lọc và độ dài vẫn giống hệt. Staple allocation dùng `recipe_generation`.
- **Rủi ro cần đo:** Dashboard có timeout 20 giây. Prompt sẽ dài hơn trước (6000 so với 4000 ký tự). Sau khi làm, đo thời gian trả lời. Nếu tỉ lệ rơi về gợi ý dự phòng tăng rõ rệt thì báo lại, không tự đổi con số.

### 4.3 Fridge planner: RAG một lần, dùng lại

- Truy vấn RAG của Recipe Builder chỉ phụ thuộc hồ sơ người dùng, không phụ thuộc bữa hay nguyên liệu. Vì vậy trong `generateDailyPlan` và `regenerateSlot`, gọi `retrieveUserReferences` **một lần**, rồi đưa kết quả cho:
  - `FridgeStapleAllocationService.allocateStaplesForPlan`: thêm phần "Reference" vào prompt chia nguyên liệu. Prompt hệ thống thêm một câu dặn dùng tài liệu để tránh nguyên liệu không hợp sức khỏe.
  - Mỗi lần gọi Recipe Builder cho từng bữa: truyền references đã có để không tìm lại. Đây là tham số nội bộ (service-to-service), **không** mở ra qua HTTP DTO.
- Recipe Builder chạy riêng lẻ (gọi qua HTTP) vẫn tự tìm RAG như cũ, với cấu hình chung ở 4.2.

### 4.4 Lọc nguyên liệu an toàn (Fridge planner)

Một hàm thuần, ví dụ `filterSafeStaples(staples, ctx) → { safe, removed: [{ food, reason }] }`, chạy **trước** bước chia nguyên liệu, trong cả `generateDailyPlan` và `regenerateSlot`. Cả nhánh LLM lẫn nhánh dự phòng chỉ thấy danh sách `safe`.

**a) Dị ứng, theo từ khóa tên món**
- Dị ứng của người dùng là các nhãn onboarding (`user.allergies`), ánh xạ sang 9 khóa chuẩn qua `ALLERGY_LABEL_TO_KEY` trong `rag-taxonomy.ts` (cần export hoặc thêm hàm tiện ích): `peanuts`, `tree_nuts`, `milk_lactose`, `eggs`, `fish`, `shellfish`, `soy`, `wheat_gluten`, `sesame`.
- Bộ từ khóa mới cho từng khóa, gồm tiếng Việt và tiếng Anh. Ví dụ `eggs`: `trứng`, `egg`, `mayonnaise`; `milk_lactose`: `sữa`, `phô mai`, `bơ sữa`, `milk`, `cheese`, `yogurt`, `whey`; `peanuts`: `đậu phộng`, `lạc`, `peanut`.
- So khớp trên `foodName` gốc trong catalog, không dịch tên (quyết định của Claude: bộ từ khóa đã có cả tiếng Việt và tiếng Anh).
- So khớp **theo từ hoặc cụm từ nguyên vẹn**, sau khi chuẩn hóa NFC và chữ thường, **không** so khớp chuỗi con. Ví dụ "cá" không được khớp "cám" hay "cà".
- Nhãn dị ứng không ánh xạ được (người dùng tự gõ) thì dùng chính nhãn đó làm từ khóa.

**b) Ngưỡng tối đa theo bệnh lý**
- Chỉ xét `conditionRelatedThresholds` có `maxAmount`.
- Loại món nếu **một khẩu phần chuẩn** (giá trị dinh dưỡng trên mỗi serving trong catalog) của chất đó **từ 80% ngưỡng cả ngày trở lên** (`>= 0.8 × maxAmount`). Đây là ngưỡng cả ngày, **không trừ** phần đã ăn (người dùng đã chốt).
  - Lý do: kết quả lọc không phụ thuộc giờ tạo kế hoạch, và không gây lỗi "thiếu nguyên liệu" về chiều tối. Bước lọc chỉ chặn món một mình đã quá nguy hiểm. Liều lượng cộng dồn cả ngày do Recipe Builder lo (budget lines theo lượng còn lại, clamp, `safetyWarnings`).
  - Hệ số 80% là quyết định của Claude, cho cụm "gần chạm hoặc vượt mức cả ngày" đã trao đổi với người dùng. Khai báo thành hằng số có tên để dễ chỉnh.
- Cần quy đổi đơn vị giữa ngưỡng và cột của `food_nutrition` (ví dụ natri: mg). Dùng `ConditionNutrientUnitService` có sẵn.
- **Không tính được thì giữ món** (fail open, người dùng đã chốt), và ghi log `warn` kèm `foodId`, nutrient, lý do. Áp dụng khi:
  - ngưỡng theo `%kcal` nhưng người dùng không có `dailyTargetCalories`;
  - món trong catalog có giá trị `null` ở chất đó;
  - chất đó không có cột tương ứng trong `food_nutrition`.
  
  Dị ứng (4.4a) không bị ảnh hưởng, luôn được lọc.
- Ngưỡng **tối thiểu** (chất xơ, kali cần bổ sung) không dùng để loại. Chúng vẫn nằm trong `nutrientLimits` để LLM ưu tiên.

**c) Hiển thị kết quả**
- Mỗi món bị loại sinh một cảnh báo ghi lý do. Response của plan không có trường warnings cấp kế hoạch, nên cảnh báo được đưa vào `generationWarnings` của từng slot được tạo trong lần chạy đó (quyết định của Claude). Ví dụ: `Removed "Trứng gà": you are allergic to eggs.`, `Removed "Nước mắm": one serving has 1400 mg sodium, more than the 800 mg left today.`
- Ngôn ngữ cảnh báo: tiếng Anh, theo kiểu các cảnh báo hiện có (quyết định của Claude).
- Lọc xong còn **ít hơn 2 món** thì không tạo kế hoạch hoặc slot. Trả lỗi 400 nói rõ cần thêm nguyên liệu phù hợp, kèm danh sách món đã bị loại.

### 4.5 Recipe Builder chạy riêng lẻ: cảnh báo dị ứng

- Khi người dùng tự chọn `foodIds` (hoặc dùng staples mặc định) qua HTTP, chạy cùng bộ so khớp dị ứng ở 4.4a.
- **Không loại món.** Thêm cảnh báo vào `safetyWarnings`, ví dụ `"Trứng gà" may contain eggs, which you are allergic to.`
- Ngưỡng bệnh lý ở luồng này giữ nguyên như hiện tại (`validateNutritionAgainstThresholds` cảnh báo sau khi có công thức).

### 4.6 Xóa cache khi hồ sơ thay đổi

Gọi `UserContextService.invalidateUserCache(userId)` mỗi khi thay đổi một trong các dữ liệu sau:
- Hồ sơ người dùng: tuổi, giới tính, chiều cao, cân nặng, chế độ ăn, dị ứng, mức vận động
- Bệnh lý
- Mục tiêu
- Ngưỡng dinh dưỡng của người dùng
- Onboarding

Builder rà các controller hoặc service đang `emitDiaryChanged` cho các thay đổi này (`users`, `onboarding`, `weight`, ...) làm điểm khởi đầu. Các chỗ đó đã xóa cache gợi ý theo ngày của Dashboard. Builder kiểm tra thêm việc sửa bệnh lý, mục tiêu và ngưỡng cũng xóa cache đó.

## 5. Ràng buộc

- Không phá API hiện có: các DTO response giữ nguyên trường.
- Prompt giữ quy tắc "không nêu con số không có trong dữ liệu hoặc tài liệu".
- Các hàm mới (`buildLlmUserProfile`, `filterSafeStaples`, so khớp dị ứng, cấu hình RAG) là hàm thuần, có unit test, theo kiểu `*.spec.ts` đang dùng.
- Theo quy trình nhóm: tạo GitHub issue cho phần việc đã duyệt trước khi code.

## 6. Tiêu chí hoàn thành

- Cùng một người dùng: khối hồ sơ trong prompt của Dashboard, Recipe và Staple allocation giống hệt nhau, kiểm bằng test so sánh output của `buildLlmUserProfile`.
- Dashboard prompt có `age` khi người dùng có tuổi.
- Cấu hình RAG chỉ khai báo một chỗ. Không còn hằng số top-K hay max-chars riêng ở Dashboard hoặc Recipe.
- Fridge plan 4 bữa gọi `retrieve` đúng 1 lần.
- Staple có tên chứa từ khóa dị ứng của người dùng không bao giờ xuất hiện trong kế hoạch Fridge, kể cả khi LLM lỗi và rơi về nhánh dự phòng.
- Cùng một tủ lạnh và cùng hồ sơ, kết quả lọc theo bệnh lý giống nhau dù tạo kế hoạch vào buổi sáng hay buổi tối.
- Recipe riêng lẻ với nguyên liệu gây dị ứng vẫn tạo được công thức và có cảnh báo trong `safetyWarnings`.
- Sửa dị ứng xong, lần tạo công thức ngay sau đó dùng dữ liệu mới.
- Có số đo thời gian trả lời của Dashboard trước và sau thay đổi.

## 7. Để builder tự quyết

- Tên file, tên hàm cụ thể và cách chia module.
- Danh sách từ khóa dị ứng đầy đủ (theo nguyên tắc ở 4.4a).
- Cách truyền references nội bộ từ Fridge planner vào Recipe Builder (tham số tùy chọn, method nội bộ...).
- Cách gom cảnh báo "đã loại món" vào response của plan hoặc slot, miễn là đi qua trường warnings đã có.
- Đổi tên `assembleRecipeGenerationContext` hoặc thêm method chung hơn cho Dashboard dùng.
