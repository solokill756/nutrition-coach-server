# Đồng bộ context LLM và lọc nguyên liệu an toàn — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard AI, Recipe Builder và Staple allocation gửi cho LLM cùng một khối hồ sơ người dùng và cùng cấu hình RAG. Fridge planner tự loại nguyên liệu gây dị ứng hoặc vượt ngưỡng bệnh lý.

**Architecture:**
- Hai module dùng chung:
  - `buildLlmUserProfile` / `formatLlmUserBlock` (nutrition): dựng khối hồ sơ.
  - `UserReferenceService` (retrieval): truy vấn RAG → lọc điểm → dựng phần tham khảo.
- Một hàm thuần `filterSafeStaples` lọc nguyên liệu trước bước chia bữa.
- Fridge planner tìm RAG một lần rồi truyền kết quả xuống bước chia nguyên liệu và Recipe Builder.
- Cache `UserContextService` bị xóa qua `DashboardEventBus`.

**Tech Stack:** NestJS 10, TypeORM, Jest (`jest.config.cjs`), TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-24-llm-context-sync-design.md`

## Global Constraints

- Nhánh: tạo `feat/llm-context-sync` từ `master`.
- Số tài liệu RAG: `Number(TOP_K)`, mặc định **6**. Ngưỡng lọc: `RAG_CONFIDENCE_THRESHOLD` (**0.6**). Giới hạn phần tham khảo: **6000** ký tự.
- Khối hồ sơ nhúng vào prompt đúng dạng `User (JSON):\n${JSON.stringify(profile)}` (không thụt lề), giống hệt nhau ở cả 3 tính năng.
- Khối hồ sơ **không** chứa kcal target, kcal còn lại hay kcal đã ăn.
- Lọc bệnh lý: loại khi 1 khẩu phần `>= 0.8 × maxAmount` (ngưỡng cả ngày, không trừ phần đã ăn). Không tính được thì giữ món và ghi log.
- Dị ứng: Fridge planner loại món. Recipe Builder chạy riêng lẻ giữ món và thêm cảnh báo vào `safetyWarnings`.
- Cảnh báo bằng tiếng Anh, đúng nguyên văn các câu ghi trong từng task.
- Không đổi trường của DTO response. Không đổi con số Dashboard đang hiển thị.
- Chạy test: `npx jest --config jest.config.cjs <file>`. Build: `npm run build`. Chạy trong WSL tại `~/calorie-counter/nutrition-coach-server`.
- Commit message theo kiểu `feat(scope): ...`, kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Nhãn dị ứng khác kiểu viết.** Gặp `"Eggs"`, `" eggs "`, hay nhãn tự gõ tiếng Việt như `"Trứng"`, bộ lọc vẫn phải bắt được "Trứng gà". Test ở Task 3.
2. **Tên món ở dạng Unicode NFD** (dấu tách rời, hay gặp khi copy từ macOS). `"Trưng gà"` vẫn phải khớp `eggs`. Test ở Task 3.
3. **Lọc xong không còn đủ món.** Người dùng có 3 món mà cả 3 bị loại thì phải nhận lỗi 400 rõ ràng nêu lý do, không crash và không ra kế hoạch rỗng. Test ở Task 6.
4. **Tạo lại một bữa** (`regenerateSlot`) cũng phải lọc, không chỉ `generateDailyPlan`. Test ở Task 6.
5. **Retrieval lỗi.** Recipe vẫn tạo được công thức và Dashboard vẫn gọi LLM, phần tham khảo là `"None."`. Test ở Task 1.

---

### Task 0: Nhánh và số đo nền của Dashboard

**Files:** không sửa code.

- [ ] **Step 1: Tạo nhánh**

```bash
git checkout master && git pull && git checkout -b feat/llm-context-sync
```

- [ ] **Step 2: Đo thời gian trả lời gợi ý Dashboard trên code hiện tại (baseline)**

Chạy server (`npm run start:dev`, cổng 3001) và đăng nhập một user thử để có `$TOKEN`. Lặp 5 lần:
1. Gọi `POST /api/water-log/add` với body `{"amountMl":100}` để xóa cache gợi ý.
2. Đo thời gian gọi gợi ý:

```bash
curl -s -o /dev/null -w "%{time_total}\n" -H "Authorization: Bearer $TOKEN" localhost:3001/api/dashboard/today/suggestion
```

Ghi lại 5 con số vào ghi chú PR (mục "Baseline").

---

### Task 1: Cấu hình RAG chung và `UserReferenceService`

**Files:**
- Create: `src/retrieval/rag-prompt-config.ts`
- Create: `src/retrieval/user-reference.service.ts`
- Create: `src/retrieval/user-reference.service.spec.ts`
- Modify: `src/retrieval/personalized-rag-query.ts` (thêm `ragQueryInputFromContext`)
- Modify: `src/retrieval/personalized-rag-query.spec.ts`
- Modify: `src/retrieval/retrieval.module.ts` (provide + export `UserReferenceService`)

**Interfaces:**
- Produces:
  - `RAG_PROMPT_TOP_K_DEFAULT = 6`, `RAG_REFERENCE_MAX_CHARS = 6000` (trong `rag-prompt-config.ts`)
  - `type UserReferences = { text: string; used: RetrievalResult[] }`
  - `class UserReferenceService { retrieve(input: PersonalizedRagQueryInput): Promise<UserReferences> }`
  - `ragQueryInputFromContext(ctx: RecipeGenerationContext, purpose: PersonalizedRagQueryInput["purpose"]): PersonalizedRagQueryInput`

- [ ] **Step 1: Viết test hỏng**

`user-reference.service.spec.ts`, mock `RetrievalService.retrieve` và `ConfigService.get`:
- `"uses TOP_K default 6"`: `TOP_K` không đặt → `retrieve` được gọi với tham số thứ hai là `6`.
- `"uses TOP_K from config"`: `TOP_K = "9"` → tham số thứ hai là `9`.
- `"drops results below 0.6"`: kết quả có score `[0.9, 0.59, 0.6]` → `used.map(r => r.score)` bằng `[0.9, 0.6]`.
- `"caps reference text at 6000 chars"`: 5 kết quả score 0.9, mỗi `content` 2500 ký tự → `text.length <= 6000`.
- `"returns None when retrieval fails"`: `retrieve` reject → kết quả là `{ text: "None.", used: [] }`.

`personalized-rag-query.spec.ts`:
- `ragQueryInputFromContext(ctx, "dashboard_suggestion")` → `purpose` là `"dashboard_suggestion"`, `goalTypes` bằng `ctx.goalsDetailed.map(g => g.goalType)`, `profile.allergies` bằng `ctx.profile.allergies`.

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx jest --config jest.config.cjs src/retrieval/user-reference.service.spec.ts src/retrieval/personalized-rag-query.spec.ts`
Expected: FAIL, "Cannot find module './user-reference.service'".

- [ ] **Step 3: Cài đặt**

- `UserReferenceService.retrieve`:
  - dựng `{ question, hints }` bằng `buildPersonalizedRagQuery(input)`;
  - gọi `retrieval.retrieve(question, topK, hints)`;
  - lọc `score >= RAG_CONFIDENCE_THRESHOLD`;
  - dựng phần tham khảo bằng `buildRagReferenceBlock(filtered, RAG_REFERENCE_MAX_CHARS)`;
  - bắt mọi lỗi, `Logger.warn`, trả `{ text: "None.", used: [] }`.

  Chuyển các dòng log `[RAG] ...` đang có trong `recipe-builder.service.ts` (~dòng 190–213) sang đây.
- `ragQueryInputFromContext`: lấy các trường giống `buildRecipeGenerationRagQuery` hiện tại, nhận thêm `purpose`.

- [ ] **Step 4: Chạy test, xác nhận qua**

Cùng lệnh ở Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/retrieval
git commit -m "feat(retrieval): shared RAG prompt config and UserReferenceService"
```

---

### Task 2: Khối hồ sơ người dùng dùng chung

**Files:**
- Create: `src/nutrition/llm-user-profile.ts`
- Create: `src/nutrition/llm-user-profile.spec.ts`
- Create: `src/nutrition/__fixtures__/llm-context.fixture.ts`
- Modify: `src/nutrition/user-context.service.ts` (thứ tự goal, cân nặng theo log)
- Modify: `src/nutrition/user-context.service.spec.ts`
- Modify: `src/nutrition/nutrition.module.ts` (thêm `WeightEntity` vào `TypeOrmModule.forFeature`; **không** import `WeightModule` vì `WeightModule` đã import `NutritionModule`)

**Interfaces:**
- Consumes: `RecipeGenerationContext`, `formatThresholdMinMax`.
- Produces:
  ```ts
  export type LlmUserProfile = {
    age: number | null; sex: string | null; heightCm: number | null;
    weightKg: number | null; goalWeightKg: number | null;
    dietType: string | null; allergies: string[]; fitnessLevel: string | null;
    goals: string[]; healthConditions: string[]; nutrientLimits: string[];
    today: { intake: Record<string, number>; remaining: Record<string, number> };
  };
  export function buildLlmUserProfile(ctx: RecipeGenerationContext): LlmUserProfile;
  export function formatLlmUserBlock(profile: LlmUserProfile): string;
  export function sampleRecipeContext(overrides?: Partial<RecipeGenerationContext>): RecipeGenerationContext; // fixture
  ```

- [ ] **Step 1: Viết test hỏng**

`llm-user-profile.spec.ts`, dùng `sampleRecipeContext()`. Fixture có:
- `age: 34`, `allergies: ["Eggs"]`
- 2 goal: `"lose_weight"`, `"low_sodium"`
- bệnh lý `"hypertension"`
- ngưỡng cá nhân `sodium max 2000 mg`; ngưỡng bệnh lý `sodium max 2000 mg` (trùng) và `potassium min 3500 mg`
- `todayIntake.totalSodium = 850.25`, `remaining.sodiumMg = 1149.75`, `remaining.calories = 900`, `remaining.carbsG = null`

Các test:
- `"maps profile fields"`: `age === 34`, `allergies` là `["Eggs"]`, `goals` là `["lose_weight", "low_sodium"]` (giữ thứ tự), `healthConditions` là `["hypertension"]`.
- `"dedupes nutrient limits"`: `nutrientLimits` chứa đúng 1 chuỗi natri và 1 chuỗi kali (dùng `formatThresholdMinMax`).
- `"today excludes calories"`: `today.intake` không có key `totalCalories`, `today.remaining` không có key `calories`.
- `"today drops nulls and rounds to 1 decimal"`: `today.remaining.sodiumMg === 1149.8`, không có key `carbsG`, `today.intake.totalSodium === 850.3`.
- `"format is compact"`: `formatLlmUserBlock(p)` bằng `"User (JSON):\n" + JSON.stringify(p)`.

`user-context.service.spec.ts`:
- `"orders goals by startDate then id"`: `goalRepo.find` được gọi với `order: { startDate: "DESC", id: "DESC" }`.
- `"weight comes from the latest weight log"`: log mới nhất có `weightKg: "72.5"` → `profile.weight === 72.5`.
- `"weight falls back to user.weight"`: không có log → `profile.weight === user.weight`.

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx jest --config jest.config.cjs src/nutrition/llm-user-profile.spec.ts src/nutrition/user-context.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt**

- `buildLlmUserProfile`:
  - `heightCm` ← `profile.height`; `weightKg` ← `profile.weight`; `goalWeightKg` ← `profile.goalWeight`.
  - `nutrientLimits` = `[...thresholds, ...conditionRelatedThresholds].map(formatThresholdMinMax).filter(Boolean)`, bỏ trùng.
  - `today.intake` = `todayIntake` bỏ `totalCalories`.
  - `today.remaining` = `remaining` bỏ `calories`, bỏ giá trị `null`.
  - Số làm tròn 1 chữ số thập phân.
- `UserContextService.fetchStaticContext`:
  - đổi thứ tự goal;
  - đọc log cân nặng mới nhất: `weightRepo.findOne({ where: { userId, delFlag: false }, order: { recordedOn: "DESC", recordedAt: "DESC" } })`;
  - `profile.weight` = log nếu có, không thì `user.weight`.

- [ ] **Step 4: Chạy test, xác nhận qua**

Cùng lệnh ở Step 2, rồi chạy cả thư mục: `npx jest --config jest.config.cjs src/nutrition`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/nutrition
git commit -m "feat(nutrition): shared LLM user profile block; goals by startDate, weight from log"
```

---

### Task 3: So khớp dị ứng và `filterSafeStaples`

**Files:**
- Create: `src/nutrition/allergen-match.ts`
- Create: `src/nutrition/allergen-match.spec.ts`
- Create: `src/recipe-builder/safe-staples.ts`
- Create: `src/recipe-builder/safe-staples.spec.ts`

**Interfaces:**
- Consumes: `allergyLabelToKey(label): string | null` (`src/rag-ingest/rag-taxonomy.ts`), `ConditionNutrientUnitService`, `UserNutrientThreshold`.
- Produces:
  ```ts
  // allergen-match.ts
  export const ALLERGEN_KEYWORDS: Record<string, string[]>; // 9 khóa: peanuts, tree_nuts, milk_lactose, eggs, fish, shellfish, soy, wheat_gluten, sesame
  export function findAllergens(foodName: string, allergies: string[]): string[]; // trả nhãn dị ứng của user bị khớp

  // safe-staples.ts
  export const CONDITION_MAX_SERVING_SHARE = 0.8;
  export type RemovedStaple = { foodId: number; foodName: string; reason: string };
  export type UncheckedStaple = { foodId: number; nutrient: string; reason: string };
  export function filterSafeStaples(
    staples: FoodNutritionEntity[],
    input: { allergies: string[]; conditionRelatedThresholds: UserNutrientThreshold[]; dailyTargetCalories: number | null },
    units: ConditionNutrientUnitService,
  ): { safe: FoodNutritionEntity[]; removed: RemovedStaple[]; unchecked: UncheckedStaple[] };
  export function allergenWarnings(foods: Pick<FoodNutritionEntity, "foodName">[], allergies: string[]): string[];
  ```

- [ ] **Step 1: Viết test hỏng**

`allergen-match.spec.ts` (gọi `findAllergens`):
- `"Trứng gà"`, `["Eggs"]` → `["Eggs"]`
- `"Trứng gà"`, `[" eggs "]` → `[" eggs "]`
- `"Trưng gà"` (NFD), `["Eggs"]` → `["Eggs"]`
- `"Cá hồi"`, `["Fish"]` → `["Fish"]`
- `"Cà chua"`, `["Fish"]` → `[]`
- `"Cám gạo"`, `["Fish"]` → `[]`
- `"Sữa chua"`, `["Milk or lactose"]` → `["Milk or lactose"]`
- `"Peanut butter"`, `["Peanuts"]` → `["Peanuts"]`
- `"Trứng vịt"`, `["Trứng"]` (nhãn tự gõ) → `["Trứng"]`
- `"Thịt heo"`, `["Eggs", "Fish"]` → `[]`

`safe-staples.spec.ts` (dùng `ConditionNutrientUnitService` thật):
- `"removes allergen foods"`: staple `"Trứng gà"` id 1, allergies `["Eggs"]` → `safe` không có id 1; `removed[0].reason === 'Removed "Trứng gà": you are allergic to Eggs.'`
- `"removes a food whose serving is >= 80% of the daily max"`: ngưỡng `sodium max 2000 mg`, món `sodium 1600` → bị loại, reason bằng `'Removed "Nước mắm": one serving has 1600 mg of sodium, at least 80% of your daily limit of 2000 mg.'`
- `"keeps a food under 80%"`: `sodium 1500` → nằm trong `safe`.
- `"ignores min-only thresholds"`: `potassium min 3500`, món `potassium 0` → nằm trong `safe`.
- `"keeps and reports when value is null"`: `sodium max 2000`, món `sodium: null` → nằm trong `safe`; `unchecked` có `{ foodId, nutrient: "sodium" }`.
- `"keeps and reports %kcal without calorie target"`: ngưỡng `carbs max 45 %kcal`, `dailyTargetCalories: null` → nằm trong `safe`; `unchecked` có 1 phần tử.
- `"allergenWarnings copy"`: `allergenWarnings([{ foodName: "Trứng gà" }], ["Eggs"])` bằng `['"Trứng gà" may contain Eggs, which you are allergic to.']`.

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx jest --config jest.config.cjs src/nutrition/allergen-match.spec.ts src/recipe-builder/safe-staples.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt**

**So khớp dị ứng.** Chuẩn hóa tên món và từ khóa: `normalize("NFC").toLowerCase()`. Tách token theo `/[^\p{L}\p{N}]+/u`. Một từ khóa khớp khi **dãy token** của nó xuất hiện liên tiếp trong dãy token tên món, nên không có khớp chuỗi con. Nhãn có `allergyLabelToKey` dùng `ALLERGEN_KEYWORDS[key]`. Nhãn không ánh xạ được thì dùng chính nhãn (đã trim) làm từ khóa. Bộ từ khóa tối thiểu:

| key | từ khóa |
|---|---|
| eggs | trứng, egg, eggs, mayonnaise |
| milk_lactose | sữa, phô mai, bơ sữa, kem sữa, milk, cheese, yogurt, butter, cream, whey |
| peanuts | đậu phộng, lạc, peanut, peanuts |
| tree_nuts | hạnh nhân, óc chó, hạt điều, hạt dẻ, hồ đào, almond, walnut, cashew, pecan, hazelnut, pistachio |
| fish | cá, fish, salmon, tuna, cod, nước mắm, fish sauce |
| shellfish | tôm, cua, ghẹ, sò, hàu, nghêu, mực, shrimp, prawn, crab, lobster, oyster, clam, mussel, squid |
| soy | đậu nành, đậu hũ, đậu phụ, tàu hũ, nước tương, xì dầu, soy, tofu, edamame |
| wheat_gluten | lúa mì, bột mì, mì, bánh mì, wheat, flour, bread, pasta, gluten |
| sesame | mè, vừng, sesame, tahini |

**Lọc theo bệnh lý.** Bảng ánh xạ nutrient (đã qua `units.normalizeNutrient`) sang cột của `FoodNutritionEntity`: `calories, protein, carbs, fat, fiber, sugars, saturatedfat→saturatedFat, sodium, potassium, calcium, iron, magnesium, phosphorus, zinc, cholesterol`. Giả định các cột này đã ở đơn vị chuẩn của `canonicalUnit`.
- `maxAmount` được quy đổi bằng `units.normalizeAmount(nutrient, maxAmount, unit, dailyTargetCalories ?? NaN)`.
- Đưa vào `unchecked` (giữ món) khi `normalizeAmount` ném lỗi, khi kết quả không hữu hạn, khi chất đó không có cột, hoặc khi giá trị của món là `null`.
- Loại món khi `value >= CONDITION_MAX_SERVING_SHARE × max`.
- Số trong câu cảnh báo làm tròn tới đơn vị.

- [ ] **Step 4: Chạy test, xác nhận qua**

Cùng lệnh ở Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/nutrition/allergen-match.* src/recipe-builder/safe-staples.*
git commit -m "feat(recipe-builder): allergen keyword matching and safe staple filter"
```

---

### Task 4: Recipe Builder dùng khối hồ sơ chung, RAG chung, cảnh báo dị ứng

**Files:**
- Modify: `src/recipe-builder/recipe-builder.service.ts`
  - inject `UserReferenceService`, bỏ inject `RetrievalService` nếu không còn dùng
  - bỏ `RECIPE_REFERENCE_MAX_CHARS` và `TOP_K`
  - thay `toPromptProfile`
  - thêm `options` cho `generateRecipe`
- Modify: `src/recipe-builder/recipe-rag-query.ts` (dùng `ragQueryInputFromContext(ctx, "recipe_generation")`)
- Modify: `src/recipe-builder/constants/recipe-prompts.ts`
- Modify: `src/recipe-builder/recipe-builder.service.spec.ts`, `src/recipe-builder/recipe-rag-query.spec.ts`

**Interfaces:**
- Consumes: `UserReferenceService`, `UserReferences` (Task 1); `buildLlmUserProfile`, `formatLlmUserBlock`, `sampleRecipeContext` (Task 2); `allergenWarnings` (Task 3).
- Produces:
  - `generateRecipe(input: RecipeBuilderRequest, userId: number, tzOffsetMinutes = 0, options: { references?: UserReferences } = {}): Promise<RecipeBuilderResponse>`
  - `RECIPE_PROMPTS.buildUserPrompt(mealSlot: string, dateKey: string, userBlock: string, recentRecipes: string[], staplePayload: object[], budgetLines: string[], constraints: Record<string, unknown>, referenceText: string): string`. In `recentRecipes` thành một dòng riêng `Recent recipes (avoid repeating): <JSON array>`.

- [ ] **Step 1: Viết / sửa test hỏng**

`recipe-builder.service.spec.ts`, với `assembleRecipeGenerationContext` trả `sampleRecipeContext()`:
- `"user prompt contains the shared user block"`: nội dung message `user` gửi cho `ollamaService.chat` chứa `formatLlmUserBlock(buildLlmUserProfile(ctx))`.
- `"retrieves references once when none are given"`: `userReferenceService.retrieve` được gọi 1 lần với `purpose: "recipe_generation"`.
- `"reuses given references"`: gọi `generateRecipe(input, 1, 0, { references: { text: "[1] Ref", used: [ref] } })` → `retrieve` không được gọi; prompt chứa `"[1] Ref"`; `response.evidence[0].id === ref.id`.
- `"warns but keeps allergen staples"`: staple `"Trứng gà"`, allergies `["Eggs"]` → `ingredients` của công thức vẫn có foodId của trứng; `safetyWarnings` chứa `'"Trứng gà" may contain Eggs, which you are allergic to.'`
- Sửa các test cũ đang mock `retrievalService.retrieve` sang mock `userReferenceService.retrieve`.

`recipe-rag-query.spec.ts`: các assertion hiện có vẫn đúng sau khi `buildRecipeGenerationRagQuery` gọi `ragQueryInputFromContext`.

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx jest --config jest.config.cjs src/recipe-builder/recipe-builder.service.spec.ts src/recipe-builder/recipe-rag-query.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt**

- `generateRecipeFromStaples` dùng `options.references ?? await userReferenceService.retrieve(ragQueryInputFromContext(recipeCtx, "recipe_generation"))`.
- `buildSystemPrompt(..., references.used.length > 0)` giữ nguyên.
- `safetyWarnings` = `[...allergenWarnings(staples, recipeCtx.profile.allergies), ...validateNutritionAgainstThresholds(...)]`.
- Xóa `toPromptProfile`.

- [ ] **Step 4: Chạy test, xác nhận qua**

Run: `npx jest --config jest.config.cjs src/recipe-builder`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recipe-builder
git commit -m "feat(recipe-builder): shared user block and RAG config; allergen warnings; reusable references"
```

---

### Task 5: Staple allocation dùng khối hồ sơ chung và RAG

**Files:**
- Modify: `src/recipe-builder/fridge-staple-allocation.service.ts`
- Modify: `src/recipe-builder/constants/allocation-prompts.ts`
- Modify: `src/recipe-builder/fridge-staple-allocation.spec.ts`

**Interfaces:**
- Consumes: `UserReferences` (Task 1); `buildLlmUserProfile`, `formatLlmUserBlock` (Task 2).
- Produces: `AllocateStaplesParams` thêm trường bắt buộc `references: UserReferences`. `buildAllocationInput` bỏ các trường `profile`, `healthDetailed`, `conditionRelatedThresholds`, `todayIntake`, `remainingToday`.

- [ ] **Step 1: Viết test hỏng**

Trong `fridge-staple-allocation.spec.ts`, mock `ollamaService.chat` để bắt nội dung message:
- `"allocation prompt has the shared user block"`: nội dung `user` chứa `formatLlmUserBlock(buildLlmUserProfile(ctx))`.
- `"allocation prompt has references"`: với `references.text = "[1] Low sodium"`, nội dung chứa `"[1] Low sodium"`.
- `"allocation input is compact"`: phần sau `Allocation input (JSON):\n` không chứa `"\n  "`.
- `"system prompt mentions references"`: nội dung `system` chứa `"Reference"`.

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx jest --config jest.config.cjs src/recipe-builder/fridge-staple-allocation.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt**

Nội dung `user` gửi LLM ghép bằng `"\n\n"`:
1. `formatLlmUserBlock(...)`
2. `` `Allocation input (JSON):\n${JSON.stringify(input)}` ``
3. `"Reference: numbered excerpts from the nutrition knowledge base."`
4. `references.text`

Thêm vào `ALLOCATION_PROMPTS.SYSTEM` dòng: `"Use the Reference excerpts and the user's allergies and health conditions to avoid unsuitable staples."`

- [ ] **Step 4: Chạy test, xác nhận qua**

Cùng lệnh ở Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recipe-builder
git commit -m "feat(recipe-builder): staple allocation uses shared user block and RAG references"
```

---

### Task 6: Fridge planner — lọc an toàn, RAG một lần, cảnh báo

**Files:**
- Modify: `src/recipe-builder/fridge-meal-planner.service.ts`
- Modify: `src/recipe-builder/fridge-meal-planner.service.spec.ts`

**Interfaces:**
- Consumes:
  - `filterSafeStaples`, `RemovedStaple` (Task 3)
  - `UserReferenceService`, `ragQueryInputFromContext` (Task 1)
  - `generateRecipe(..., options)` (Task 4)
  - `AllocateStaplesParams.references` (Task 5)
  - `ConditionNutrientUnitService` (đã được `NutritionModule` export)
- Produces: `generateSlot` options thêm `references: UserReferences` và `removedWarnings: string[]`.

- [ ] **Step 1: Viết test hỏng**

- `"retrieves references once per plan"`: kế hoạch 4 bữa → `userReferenceService.retrieve` gọi 1 lần; `recipeBuilderService.generateRecipe` gọi 4 lần, tham số thứ tư luôn là cùng một object `{ references }`.
- `"never allocates allergen staples"`: staples `["Trứng gà"(1), "Thịt heo"(2), "Rau muống"(3), "Gạo"(4)]`, allergies `["Eggs"]` → `allocateStaplesForPlan` nhận `params.staples` không có id 1.
- `"heuristic fallback never picks allergen staples"`: dùng `FridgeStapleAllocationService` thật, `ollamaService.chat` reject → mọi `allocations[slot]` đều không chứa id 1.
- `"removal reasons reach slot warnings"`: mỗi slot được tạo trong lần chạy có `generationWarnings` chứa `'Removed "Trứng gà": you are allergic to Eggs.'`
- `"400 when fewer than 2 safe staples"`: staples `["Trứng gà", "Trứng vịt", "Gạo"]`, allergies `["Eggs"]` → ném `BadRequestException`, message chứa `"Not enough suitable staple foods"` và `'Removed "Trứng gà"'`.
- `"regenerateSlot filters too"`: `regenerateSlot` với cùng dữ liệu như test "never allocates" → `params.staples` không có id 1.

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx jest --config jest.config.cjs src/recipe-builder/fridge-meal-planner.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt**

Trong cả `generateDailyPlan` và `regenerateSlot`, ngay sau khi có `ctx`:
1. Gọi `filterSafeStaples(staples, { allergies: ctx.profile.allergies, conditionRelatedThresholds: ctx.conditionRelatedThresholds, dailyTargetCalories: ctx.dailyTargetCalories }, this.units)`.
2. Mỗi phần tử `unchecked` ghi một dòng `logger.warn`.
3. Nếu `safe.length < 2`, ném `BadRequestException(\`Not enough suitable staple foods. ${removed.map(r => r.reason).join(" ")} Add more pantry items.\`)`.
4. `references = await this.userReferences.retrieve(ragQueryInputFromContext(ctx, "recipe_generation"))`.
5. Truyền `safe` (thay cho `staples`) và `references` vào allocation và `generateSlot`.

Trong `generateSlot`: gọi `generateRecipe(..., userId, 0, { references })`, rồi đặt `removedWarnings` lên đầu `generationWarnings` trước khi lưu và trả slot.

Kiểm tra cũ `staples.length < 2` (trước khi lọc) giữ nguyên.

- [ ] **Step 4: Chạy test, xác nhận qua**

Run: `npx jest --config jest.config.cjs src/recipe-builder`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recipe-builder
git commit -m "feat(fridge): filter unsafe staples, retrieve RAG once per plan, surface removals"
```

---

### Task 7: Dashboard AI dùng `UserContextService`, khối hồ sơ chung và RAG chung

**Files:**
- Modify: `src/dashboard/dashboard-ai.service.ts`
- Modify: `src/dashboard/dashboard.service.ts` (`getTodaySuggestion`)
- Create: `src/dashboard/dashboard-ai.service.spec.ts`
- Modify: `src/dashboard/dashboard.service.spec.ts`

**Interfaces:**
- Consumes:
  - `UserContextService.assembleRecipeGenerationContext` (gọi với `mealSlot` là `"breakfast"`; `buildLlmUserProfile` không dùng `mealSlot`)
  - `buildLlmUserProfile`, `formatLlmUserBlock`, `sampleRecipeContext` (Task 2)
  - `UserReferenceService`, `ragQueryInputFromContext` (Task 1)
- Produces: `DashboardAiSuggestionContext` bỏ `user`, `healthDetailed`, `conditionRelatedThresholds`, thêm `userContext: RecipeGenerationContext`. Các trường `calories`, `macros`, `exercise`, `water`, `remaining`, `alerts` giữ nguyên và vẫn tính như hiện tại.

- [ ] **Step 1: Viết test hỏng**

`dashboard-ai.service.spec.ts`, mock `OllamaService` và `UserReferenceService`:
- `"prompt has the shared user block with age"`: với `sampleRecipeContext()` (age 34), nội dung `user` chứa `formatLlmUserBlock(buildLlmUserProfile(ctx))` và chứa `"\"age\":34"`.
- `"prompt has dashboard-only data"`: chứa `"Dashboard today (JSON):\n"` và `"\"water\""`.
- `"uses shared RAG with dashboard purpose"`: `retrieve` gọi 1 lần với `purpose: "dashboard_suggestion"`; nội dung chứa `references.text`.
- `"falls back when the LLM fails"`: `chat` reject → trả `buildFallbackSuggestion(...)`.

`dashboard.service.spec.ts`:
- `"getTodaySuggestion builds context from UserContextService"`: `assembleRecipeGenerationContext` gọi với `(userId, dateKey, "breakfast", tz)`, và `buildAiSuggestion` nhận `ctx.userContext` là kết quả của lời gọi đó.

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx jest --config jest.config.cjs src/dashboard`
Expected: FAIL.

- [ ] **Step 3: Cài đặt**

Nội dung `user` ghép bằng `"\n\n"`:
1. `"Create one practical suggestion for today from this dashboard context."`
2. `formatLlmUserBlock(...)`
3. `` `Dashboard today (JSON):\n${JSON.stringify({ calories, macros, water, exercise, alerts })}` `` (giữ cách map `alerts` hiện tại)
4. `` `Retrieved reference snippets:\n${references.text}` ``

Xóa `AI_SUGGESTION_REFERENCE_MAX_CHARS` và `retrieveSuggestionContexts`. Trong `getTodaySuggestion`, xóa đoạn query bệnh lý / rule / `buildConditionRelatedThresholds`. Xóa các inject không còn dùng (`ruleRepo`, `conditionNutrientUnits`, ...) nếu `loadDashboardBase` không dùng tới.

Thêm log quanh lời gọi LLM: `this.logger.log(\`[DASHBOARD-AI] latencyMs=${ms} fallback=${usedFallback}\`)`.

- [ ] **Step 4: Chạy test, xác nhận qua**

Cùng lệnh ở Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard
git commit -m "feat(dashboard): AI suggestion uses UserContextService, shared user block and RAG config"
```

---

### Task 8: Xóa cache context khi hồ sơ thay đổi

**Files:**
- Modify: `src/nutrition/user-context.service.ts` (lắng nghe `DashboardEventBus`, implement `OnModuleDestroy`)
- Modify: `src/users/users.controller.ts` (`PATCH profile` gọi `emitDiaryChanged`)
- Modify: `src/onboarding/onboarding.controller.ts` (`PATCH basic-info`, `PATCH goal-preferences`, `POST complete` gọi `emitDiaryChanged`)
- Modify: `src/nutrition/user-context.service.spec.ts`

**Interfaces:**
- Consumes: `DashboardEventBus` (`@Global`, `src/dashboard/dashboard-event-bus.ts`): `onDiaryChanged(listener)`, `removeListener(listener)`, `emitDiaryChanged(userId, dateKey)`.

- [ ] **Step 1: Viết test hỏng**

`user-context.service.spec.ts`:
- `"diary-changed event clears the static cache"`: gọi `assembleContext(1)` 2 lần thì `userRepo.findOne` được gọi 1 lần. Sau đó `bus.emitDiaryChanged(1, "2026-10-24")` rồi gọi `assembleContext(1)` → `userRepo.findOne` được gọi tổng cộng 2 lần.
- `"other users' cache is kept"`: `emitDiaryChanged(2, ...)` không làm user 1 query lại.

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx jest --config jest.config.cjs src/nutrition/user-context.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt**

Đăng ký listener `(e) => this.invalidateUserCache(e.userId)` trong constructor và gỡ trong `onModuleDestroy`. Thêm `emitDiaryChanged(userId, resolveClientDateKey(undefined, 0))` vào 4 endpoint đã liệt kê, theo đúng kiểu đang dùng ở `PATCH goal`.

- [ ] **Step 4: Chạy test, xác nhận qua**

Run: `npx jest --config jest.config.cjs src/nutrition src/users src/onboarding`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/nutrition src/users src/onboarding
git commit -m "fix(nutrition): clear user LLM context cache when profile, health or goals change"
```

---

### Task 9: Kiểm tra toàn bộ và đo lại Dashboard

**Files:** không sửa code (trừ khi phải sửa lỗi phát hiện ra).

- [ ] **Step 1: Chạy toàn bộ test**

Run: `npm test`. Expected: tất cả PASS.

- [ ] **Step 2: Build**

Run: `npm run build`. Expected: không có lỗi TypeScript.

- [ ] **Step 3: Kiểm tra không còn hằng RAG riêng**

Run: `grep -rn "AI_SUGGESTION_REFERENCE_MAX_CHARS\|RECIPE_REFERENCE_MAX_CHARS\|get<number>(\"TOP_K\")" src`. Expected: không có kết quả.

- [ ] **Step 4: Đo lại thời gian trả lời Dashboard**

Lặp đúng quy trình ở Task 0 Step 2, ghi 5 con số mới cùng các dòng log `[DASHBOARD-AI] latencyMs=` vào ghi chú PR. Nếu có lần `fallback=true`, hoặc thời gian trung bình tăng hơn 30% so với baseline, ghi rõ trong PR để người dùng quyết định. **Không** tự đổi các con số cấu hình RAG.

- [ ] **Step 5: Thử tay luồng Fridge với dị ứng**

Đặt allergies của user thử là `["Eggs"]`, thêm staple "Trứng gà" và ít nhất 3 staple khác, gọi tạo kế hoạch Fridge. Kỳ vọng: không bữa nào chứa trứng, và mỗi bữa có cảnh báo `Removed "Trứng gà": you are allergic to Eggs.`
