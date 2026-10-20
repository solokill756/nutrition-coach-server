# Đồng bộ 11 chỉ số dinh dưỡng (backend): kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend tính toán, cảnh báo và trả về đồng bộ bộ 11 chỉ số (calories, protein, carbs, fat, fiber, sugars, sodium, saturatedFat, cholesterol, potassium, phosphorus), và chỉ thêm field mới vào API.

**Architecture:** Có 4 thay đổi độc lập.
- Sửa hệ số `%kcal`.
- Sửa bộ luật cảnh báo, kèm hàm thuần `buildHealthNutrients` cho dashboard.
- Thêm hàm thuần `sumDayIntake` để user-context tự cộng LogFood, thay cho việc đọc bảng `DailyNutritionSummary`.
- Bổ sung field cho các object `food{}` lồng.

Mỗi task có test Jest riêng.

**Tech Stack:** NestJS, TypeORM, Jest + ts-jest (`npm test`), TypeScript (`npm run build`).

**Spec:** `docs/superpowers/specs/2026-10-18-nutrition-sync-design.md`. Issue: solokill756/nutrition-coach-server#6.

## Global Constraints

- **Chỉ thêm field vào response API.** Không đổi tên và không xoá field hiện có, vì app Flutter và web đang đọc chúng (`macros`, `micronutrients`, `dietaryFibersG`, `sugarsG`, `folate`…).
- Không thêm migration, không đổi schema database. Không xoá entity `DailyNutritionSummary`.
- 12 vi chất (calcium, iron, magnesium, zinc, vitamin A/C/D/E/K/B6/B12, folate) vẫn giữ trong database và response, chỉ không còn sinh cảnh báo.
- Cảnh báo max protein **chỉ** bật khi ngưỡng đến từ rule theo bệnh, tức `origin === "admin_rule"` (không dựa vào `sourceConditionKey`, vì khóa này có thể còn sót sau khi bỏ bệnh).
- `healthNutrients` chỉ trả bound theo hướng cảnh báo: fiber và potassium trả `min`; sugars, sodium, saturatedFat, cholesterol, phosphorus trả `max`; bound còn lại luôn `null`.
- Làm trên nhánh mới `feat/nutrition-sync` tạo từ `feat/meal-splits`.
- Lệnh chạy từ thư mục `nutrition-coach-server`. Nếu git báo "dubious ownership" thì thêm `-c safe.directory='*'` vào lệnh, **không** sửa cấu hình git global.
- Commit message kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Tên ngưỡng có biến thể** (`saturated_fat`, `dietary_fiber`, `Phosphorus`) vẫn phải khớp đúng chỉ số trong `healthNutrients`. Test nằm ở Task 3.
2. **Log món gần nửa đêm theo giờ địa phương** (ví dụ UTC+7) phải được tính vào đúng ngày trong recipe context. Cách làm: truyền `tzOffsetMinutes` và dùng cùng `calendarDayBounds` như diary. Test nằm ở Task 4.
3. **Dòng LogFood cũ có `phosphorusMg`/`dietaryFibersG` là `null` hoặc chuỗi rỗng** phải cộng thành 0, không được ra `NaN`. Test nằm ở Task 4.
4. **User không có ngưỡng nào:** `healthNutrients` có mọi `min`/`max` là `null` và không có cảnh báo. Test nằm ở Task 3.
5. **Tương thích Flutter:** `macros` và `micronutrients` của `dashboard/today` vẫn còn nguyên. Test nằm ở Task 3.

---

### Task 0: Tạo nhánh

- [ ] **Step 1:** `git checkout -b feat/nutrition-sync` (đang ở `feat/meal-splits`).
- [ ] **Step 2:** `npm test`. Expected: toàn bộ PASS. Đây là baseline; nếu có test fail sẵn, ghi lại tên test trước khi sửa gì.

### Task 1: Hệ số `%kcal` theo từng chất (B5)

**Files:**
- Modify: `src/nutrition/condition-nutrient-unit.service.ts:41-43`
- Test: `src/nutrition/condition-nutrient-unit.service.spec.ts`

**Interfaces:**
- Produces: `normalizeAmount` giữ nguyên signature. Riêng nhánh `%kcal` dùng hệ số 9 cho `fat`/`saturatedfat`, và 4 cho `carbs`/`protein`/`sugars`/`fiber`.

- [ ] **Step 1: Viết test fail**

```ts
it("converts carbs percent calories to grams with 4 kcal/g", () => {
  expect(service.normalizeAmount("carbs", 50, "%kcal", 2000)).toEqual({ amount: 250, unit: "g" });
});
it("converts protein percent calories to grams with 4 kcal/g", () => {
  expect(service.normalizeAmount("protein", 20, "% kcal", 2000)).toEqual({ amount: 100, unit: "g" });
});
it("converts fat percent calories to grams with 9 kcal/g", () => {
  expect(service.normalizeAmount("fat", 30, "%kcal", 1800)).toEqual({ amount: 60, unit: "g" });
});
```

Test cũ `saturatedFat 6 %kcal 2000 → 13.3` phải giữ nguyên.

- [ ] **Step 2:** `npx jest src/nutrition/condition-nutrient-unit.service.spec.ts`. Expected: 2 test carbs/protein FAIL (đang ra 111.1 và 44.4).
- [ ] **Step 3: Thêm `private kcalPerGram(nutrientKey: string): 4 | 9`.** Hàm trả 9 khi key đã normalize là `fat` hoặc `saturatedfat`, ngược lại trả 4. Dùng hàm này thay cho số `9` ở nhánh `%kcal`.
- [ ] **Step 4:** chạy lại test như Step 2. Expected: PASS hết.
- [ ] **Step 5: Commit** `fix(nutrition): convert %kcal rules with 4 kcal/g for carbs and protein`

### Task 2: Bộ luật cảnh báo theo bộ 11 (B2)

**Files:**
- Modify: `src/dashboard/dashboard-alert.service.ts:50-80, 167-204`
- Test: `src/dashboard/dashboard-alert.service.spec.ts`

**Interfaces:**
- Produces: `AlertRule` thêm field tùy chọn `conditionOnly?: boolean`.
  - `MAX_ALERT_RULES` = calories, carbs, fat, sugars, sodium, saturatedFat, cholesterol, `{ nutrientType: "protein", thresholdKey: "protein", label: "Protein", conditionOnly: true }`, `{ nutrientType: "phosphorus", thresholdKey: "phosphorus", label: "Phosphorus" }`.
  - `MIN_ALERT_RULES` = protein, fiber, potassium.
  - `buildDailyAlerts` giữ nguyên signature.

- [ ] **Step 1: Sửa helper trong spec.**
  - `threshold()` nhận thêm `origin?: string` và `sourceConditionKey?: string | null`, rồi gán vào object trả về.
  - `totals()` thêm mặc định `phosphorus: 500`.
- [ ] **Step 2: Viết test fail.** Thay test "creates warning alerts for calcium and iron…" bằng test 1 bên dưới, rồi thêm 4 test còn lại.

```ts
it("does not alert on micronutrients below their minimum", () => {
  expect(service.buildDailyAlerts("2026-05-22", totals({ calcium: 600, iron: 8 }), [
    threshold("calcium", { min: 1000, unit: "mg" }),
    threshold("iron", { min: 18, unit: "mg" }),
    threshold("vitaminC", { min: 90, unit: "mg" }),
  ])).toEqual([]);
});
it("creates a High Protein alert when the max comes from a condition rule", () => {
  const alerts = service.buildDailyAlerts("2026-05-22", totals({ protein: 80 }), [
    threshold("protein", { max: 70, unit: "g", origin: "admin_rule", sourceConditionKey: "kidney_disease" }),
  ]);
  expect(alerts).toEqual([expect.objectContaining({
    id: "2026-05-22:protein:max", severity: "critical", title: "High Protein", limit: 70,
  })]);
});
it("ignores the system protein max but still warns below the protein min", () => {
  expect(service.buildDailyAlerts("2026-05-22", totals({ protein: 130 }), [
    threshold("protein", { min: 90, max: 112, unit: "g", origin: "system" }),
  ])).toEqual([]);
  expect(service.buildDailyAlerts("2026-05-22", totals({ protein: 50 }), [
    threshold("protein", { min: 90, max: 112, unit: "g", origin: "system" }),
  ])).toEqual([expect.objectContaining({ id: "2026-05-22:protein:min", title: "Low Protein" })]);
});
it("creates a High Phosphorus alert above the max", () => {
  expect(service.buildDailyAlerts("2026-05-22", totals({ phosphorus: 900 }), [
    threshold("phosphorus", { max: 800, unit: "mg", origin: "admin_rule", sourceConditionKey: "kidney_disease" }),
  ])).toEqual([expect.objectContaining({ id: "2026-05-22:phosphorus:max", title: "High Phosphorus", unit: "mg" })]);
});
it("does not alert when phosphorus is below the system min", () => {
  expect(service.buildDailyAlerts("2026-05-22", totals({ phosphorus: 300 }), [
    threshold("phosphorus", { min: 700, unit: "mg", origin: "system" }),
  ])).toEqual([]);
});
```

- [ ] **Step 3:** `npx jest src/dashboard/dashboard-alert.service.spec.ts`. Expected: các test mới FAIL.
- [ ] **Step 4: Sửa code.**
  - Cập nhật 2 mảng rule như phần Interfaces.
  - Trong `buildAlert`, return `null` khi `rule.conditionOnly` mà ngưỡng không đến từ rule bệnh.
  - Kiểm tra "đến từ rule bệnh" bằng `private isConditionThreshold(t: UserNutritionalThresholdEntity | undefined): boolean`, trả `t?.origin === "admin_rule"`.
  - Giữ nguyên `NUTRIENT_PRIORITY`.
- [ ] **Step 5:** chạy lại test như Step 3. Expected: PASS hết, kể cả test sort/limit cũ.
- [ ] **Step 6: Commit** `feat(dashboard): alert on the 11-nutrient set; protein max only for condition rules`

### Task 3: `healthNutrients` trên `dashboard/today` (B1)

**Files:**
- Modify: `src/dashboard/dashboard-alert.service.ts` (thêm type và method)
- Modify: `src/dashboard/dashboard.service.ts:82` (interface response, đặt cạnh `micronutrients`) và `:191-245` (object trả về)
- Test: `src/dashboard/dashboard-alert.service.spec.ts`, `src/dashboard/dashboard.service.spec.ts`

**Interfaces:**
- Consumes: `indexThresholds` (private, đã có; xử lý alias fiber và normalize tên).
- Produces, export từ `dashboard-alert.service.ts`:

```ts
export type HealthNutrientKey =
  "fiber" | "sugars" | "sodium" | "saturatedFat" | "cholesterol" | "potassium" | "phosphorus";
export type HealthNutrientValue = { current: number; min: number | null; max: number | null; unit: "g" | "mg" };
export type DashboardHealthNutrients = Record<HealthNutrientKey, HealthNutrientValue>;
// method trên DashboardAlertService:
buildHealthNutrients(totals: DashboardDailyTotals, thresholds: UserNutritionalThresholdEntity[]): DashboardHealthNutrients;
```

- Bảng cố định cho từng chỉ số:

| key | hướng | đơn vị | thresholdKey |
|---|---|---|---|
| fiber | min | g | `fiber` |
| sugars | max | g | `sugars` |
| sodium | max | mg | `sodium` |
| saturatedFat | max | g | `saturatedfat` |
| cholesterol | max | mg | `cholesterol` |
| potassium | min | mg | `potassium` |
| phosphorus | max | mg | `phosphorus` |

- Quy tắc tính:
  - `current` làm tròn 1 chữ số thập phân; nếu không phải số hữu hạn thì là 0.
  - Bound theo hướng = giá trị ngưỡng làm tròn 1 chữ số nếu là số hữu hạn > 0, ngược lại `null`.
  - Bound hướng còn lại luôn `null`.

- [ ] **Step 1: Viết test fail** trong `dashboard-alert.service.spec.ts`.

```ts
describe("buildHealthNutrients", () => {
  it("returns only the alerted bound per nutrient", () => {
    const out = service.buildHealthNutrients(totals({ fiber: 25, sodium: 1000, phosphorus: 500 }), [
      threshold("fiber", { min: 25, max: 40, unit: "g" }),
      threshold("sodium", { min: 500, max: 1500, unit: "mg" }),
      threshold("phosphorus", { min: 700, unit: "mg" }),
    ]);
    expect(out.fiber).toEqual({ current: 25, min: 25, max: null, unit: "g" });
    expect(out.sodium).toEqual({ current: 1000, min: null, max: 1500, unit: "mg" });
    expect(out.phosphorus).toEqual({ current: 500, min: null, max: null, unit: "mg" });
    expect(out.sugars).toEqual({ current: 20, min: null, max: null, unit: "g" });
  });
  it("matches aliased threshold names", () => {
    const out = service.buildHealthNutrients(totals(), [
      threshold("saturated_fat", { max: 20 }),
      threshold("dietary_fiber", { min: 28 }),
      threshold("Phosphorus", { max: 800, unit: "mg" }),
    ]);
    expect(out.saturatedFat.max).toBe(20);
    expect(out.fiber.min).toBe(28);
    expect(out.phosphorus.max).toBe(800);
  });
  it("returns null bounds for every nutrient without thresholds", () => {
    const out = service.buildHealthNutrients(totals(), []);
    for (const v of Object.values(out)) expect([v.min, v.max]).toEqual([null, null]);
    expect(Object.keys(out).sort()).toEqual(
      ["cholesterol", "fiber", "phosphorus", "potassium", "saturatedFat", "sodium", "sugars"]);
  });
});
```

Trong `dashboard.service.spec.ts`, thêm vào `describe` hiện có (cùng `createService`):

```ts
it("adds healthNutrients and keeps macros and micronutrients", async () => {
  const { service } = createService(jest.fn());
  const result = await service.getTodayDashboard(1, "2026-05-22");
  expect(result.healthNutrients.sodium).toEqual({ current: 2500, min: null, max: 1500, unit: "mg" });
  expect(result.macros.protein).toBeDefined();
  expect(result.micronutrients).toBeDefined();
});
```

- [ ] **Step 2:** `npx jest src/dashboard`. Expected: các test mới FAIL vì `buildHealthNutrients` chưa có.
- [ ] **Step 3: Cài đặt** type và method trong `dashboard-alert.service.ts`. Sau đó:
  - Thêm `healthNutrients: DashboardHealthNutrients` vào interface response ở `dashboard.service.ts:82`.
  - Gán `healthNutrients: this.dashboardAlertService.buildHealthNutrients(base.dailyTotals, base.thresholds)` vào object trả về, đặt ngay trước `micronutrients`.
- [ ] **Step 4:** `npx jest src/dashboard`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(dashboard): expose healthNutrients with alert-direction bounds`

### Task 4: Recipe context tự cộng LogFood, thêm fiber và phosphorus (B3)

**Files:**
- Create: `src/nutrition/day-intake-totals.ts`, `src/nutrition/day-intake-totals.spec.ts`
- Modify: `src/nutrition/user-context.service.ts`
  - type `todayIntake`/`remaining` (~:103-127), `todaySummary` (~:136-146)
  - constructor (~:162-182)
  - `assembleRecipeGenerationContext` (~:325-420), `assembleContext` (~:440-480)
- Modify: `src/recipe-builder/recipe-builder.service.ts`
  - :153 (truyền tz)
  - ~:240-263 (budget lines)
  - ~:505-512 (`clampRecipeToRemainingBudgets`), ~:553-560 (`verifyBudget`)
- Modify: `src/recipe-builder/fridge-meal-planner.service.ts:168, :268, :379` (truyền tz)
- Test: `src/nutrition/user-context.service.spec.ts`, `src/recipe-builder/recipe-builder.service.spec.ts`. Nếu TypeScript báo thiếu field thì sửa thêm `makeRecipeCtx().remaining` (~:105).

**Interfaces:**
- Produces trong `day-intake-totals.ts`:

```ts
export type DayIntakeTotals = {
  totalCalories: number; totalProtein: number; totalCarbs: number; totalFat: number;
  totalSodium: number; totalSugar: number; totalSaturatedFat: number; totalCholesterol: number;
  totalPotassium: number; totalFiber: number; totalPhosphorus: number;
};
export function sumDayIntake(rows: Array<Pick<LogFoodEntity,
  "calories" | "proteinG" | "totalCarbohydratesG" | "totalFatG" | "sodiumMg" | "sugarsG" |
  "saturatedFatG" | "cholesterolMg" | "potassiumMg" | "dietaryFibersG" | "phosphorusMg">>): DayIntakeTotals;
```

  Mỗi giá trị cộng theo kiểu `Number(v) || 0`, giống `diary.service.ts:147-157`.

- Produces trong `UserContextService`:
  - `assembleRecipeGenerationContext(userId: number, dateKey: string, mealSlot: RecipeGenerationMealSlot, tzOffsetMinutes = 0)`.
  - `todayIntake` và `todaySummary` có kiểu `DayIntakeTotals`. `todaySummary` luôn là object, bằng 0 hết khi không có log.
  - `remaining` thêm `fiberGMinRemaining: number | null` (từ `getThresholdMin(thresholds, "fiber")`) và `phosphorusMg: number | null` (từ `getThresholdMax(thresholds, "phosphorus")`). Cả hai tính bằng `Math.max(0, …)` giống các field hiện có.
- Lấy dữ liệu: `logRepo.find({ where: { userId, delFlag: false, loggedAt: Between(start, end) } })`, với `{ start, end } = calendarDayBounds(key, tzOffsetMinutes)` import từ `../common/date/calendar-day-bounds`. `assembleContext` dùng `today = localDateKeyNow(tzOffsetMinutes)` như hiện tại.
- Bỏ `summaryRepo` khỏi constructor và bỏ import `DailyNutritionSummaryEntity` trong file này. Giữ entity và `forFeature` trong `nutrition.module.ts`.

- [ ] **Step 1: Viết `day-intake-totals.spec.ts`, phải fail.**

```ts
it("sums snapshot strings and treats null or empty as 0", () => {
  const out = sumDayIntake([
    { calories: "300", proteinG: "20", totalCarbohydratesG: "30", totalFatG: "10", sodiumMg: "400",
      sugarsG: "4", saturatedFatG: "2", cholesterolMg: "50", potassiumMg: "300", dietaryFibersG: "5", phosphorusMg: "200" },
    { calories: "500", proteinG: null, totalCarbohydratesG: "", totalFatG: "5", sodiumMg: null,
      sugarsG: "6", saturatedFatG: null, cholesterolMg: null, potassiumMg: null, dietaryFibersG: null, phosphorusMg: null },
  ] as any);
  expect(out).toEqual({
    totalCalories: 800, totalProtein: 20, totalCarbs: 30, totalFat: 15, totalSodium: 400, totalSugar: 10,
    totalSaturatedFat: 2, totalCholesterol: 50, totalPotassium: 300, totalFiber: 5, totalPhosphorus: 200,
  });
});
it("returns zeros for no rows", () => {
  expect(Object.values(sumDayIntake([]))).toEqual(Array(11).fill(0));
});
```

- [ ] **Step 2:** `npx jest src/nutrition/day-intake-totals.spec.ts`. Expected: FAIL (module chưa tồn tại).
- [ ] **Step 3:** cài đặt `sumDayIntake`.
- [ ] **Step 4:** chạy lại test như Step 2. Expected: PASS.
- [ ] **Step 5: Sửa `user-context.service.spec.ts`, phải fail.**
  - `setup()`: bỏ `summaryRepo` khỏi constructor; gọi `logRepo.find.mockImplementation(async (opts: any) => (opts?.take ? [] : todayRows))` với `let todayRows: any[] = []` có thể gán trong từng test.
  - Mọi chỗ đang `summaryRepo.findOne.mockResolvedValueOnce({...})` đổi thành gán `todayRows`. Ví dụ test "returns remaining budgets" dùng `todayRows = [{ calories: "800", sugarsG: "10" }]`, vẫn kỳ vọng `remaining.calories === 1200` và `remaining.sugarG === 40`.
  - Test "carries…": đổi `expect(logRepo.find).toHaveBeenCalledTimes(1)` thành `2`.
  - Test "assembleContext maps summary…": đổi thành kỳ vọng `logRepo.find` được gọi đúng 1 lần, không có `take`, và `todaySummary.totalCalories` bằng tổng `todayRows`.
  - Thêm test:

```ts
it("assembleRecipeGenerationContext adds fiber and phosphorus from today's logs", async () => {
  const { service, userRepo, goalRepo, thresholdRepo, logRepo } = setup();
  userRepo.findOne.mockResolvedValueOnce({ id: 1, age: 20, sex: "male", weight: 70, goalWeight: 68, height: 170, dietType: null, allergies: [], fitnessLevel: "active" });
  goalRepo.find.mockResolvedValueOnce([{ id: 1, goalType: "maintenance", targetCalories: 2000, startDate: new Date(), endDate: null }]);
  thresholdRepo.find.mockResolvedValueOnce([
    { nutrient: "fiber", minAmount: 25, maxAmount: null, unit: "g" },
    { nutrient: "phosphorus", minAmount: null, maxAmount: 800, unit: "mg" },
  ]);
  todayRows = [
    { calories: "300", dietaryFibersG: "5", phosphorusMg: "200" },
    { calories: "500", dietaryFibersG: "3", phosphorusMg: "150" },
  ];
  const out = await service.assembleRecipeGenerationContext(1, "2026-05-31", "lunch", -420);
  expect(out.todayIntake).toMatchObject({ totalCalories: 800, totalFiber: 8, totalPhosphorus: 350 });
  expect(out.remaining.fiberGMinRemaining).toBe(17);
  expect(out.remaining.phosphorusMg).toBe(450);
  const { start, end } = calendarDayBounds("2026-05-31", -420);
  expect(logRepo.find).toHaveBeenCalledWith({ where: { userId: 1, delFlag: false, loggedAt: Between(start, end) } });
});
```

- [ ] **Step 6:** `npx jest src/nutrition/user-context.service.spec.ts`. Expected: FAIL.
- [ ] **Step 7: Sửa `user-context.service.ts`** theo phần Interfaces.
- [ ] **Step 8:** chạy lại test như Step 6. Expected: PASS.
- [ ] **Step 9: Sửa recipe-builder.**
  - `recipe-builder.service.ts:153` và 3 chỗ ở `fridge-meal-planner.service.ts` truyền `tzOffsetMinutes` làm tham số thứ 4. Chỗ nào method bao quanh không có biến này thì để mặc định.
  - Budget lines: thêm sau dòng potassium:
    - `Fiber target still needed today: ~${Math.round(r.fiberGMinRemaining * 10) / 10} g.`
    - `Max phosphorus (mg) per serving: ~${Math.round(r.phosphorusMg)} mg remaining today.`
    - Mỗi dòng chỉ thêm khi giá trị khác `null`.
  - `clampRecipeToRemainingBudgets`: thêm `considerCap(n.phosphorusMg, remaining.phosphorusMg)`.
  - `verifyBudget`: thêm `check("phosphorus", n.phosphorusMg, remaining.phosphorusMg)`.
- [ ] **Step 10: Test cho recipe-builder** trong `recipe-builder.service.spec.ts`:

```ts
it("clampRecipeToRemainingBudgets scales for phosphorus", () => {
  const { service } = createService();
  const recipe: any = { ingredients: [{ amount_g: 100, amount: 1 }], nutritionPerServing: { calories: 100, phosphorusMg: 400 } };
  const warnings: string[] = [];
  expect((service as any).clampRecipeToRemainingBudgets(recipe, { phosphorusMg: 200 }, warnings)).toBe("adjusted");
  expect(recipe.ingredients[0].amount_g).toBe(50);
});
it("verifyBudget warns when phosphorus still exceeds remaining", () => {
  const { service } = createService();
  expect((service as any).verifyBudget({ nutritionPerServing: { phosphorusMg: 400 } }, { phosphorusMg: 200 }, [])).toBe("warning");
});
```

- [ ] **Step 11:** `npx jest src/nutrition src/recipe-builder`. Expected: PASS.
- [ ] **Step 12: Commit** `feat(nutrition): recipe context sums today's logs and budgets fiber and phosphorus`

### Task 5: Bổ sung macro cho `food{}` lồng (B4)

**Files:**
- Modify: `src/nutrition/log-food.service.ts:418-428`, `src/meal-planning/meals.service.ts:200-224`
- Test: `src/nutrition/log-food.service.spec.ts`, `src/meal-planning/meals.service.spec.ts`

**Interfaces:**
- Produces:
  - `food{}` trong log item thêm `calories: Number(food.calories)`, `proteinG: Number(food.protein)`, `totalCarbohydratesG: Number(food.carbs)`, `totalFatG: Number(food.fat)`, `dietaryFibersG: Number(food.fiber)`, `sodiumMg: Number(food.sodium)`. Các cột này `NOT NULL default 0`.
  - `food{}` trong meal item thêm `proteinG: food.protein ?? null`, `totalCarbohydratesG: food.carbs ?? null`, `totalFatG: food.fat ?? null`, `dietaryFibersG: food.fiber ?? null`, `sodiumMg: food.sodium ?? null`, theo kiểu `?? null` đang dùng trong object này.
  - Giá trị lấy thô từ Food, giống các field hiện có trong object.

- [ ] **Step 1: Viết test fail.**
  - Trong `log-food.service.spec.ts`, mô phỏng theo test `mapRowsToApiItems preserves snapshot fields…`: `foodRepo.find` trả `[{ id: 99, foodName: "Rice", category: null, servingUnit: "g", servingSize: 100, calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sodium: 1, isVerified: true }]`. Kỳ vọng `items[0].food` `toMatchObject({ calories: 130, proteinG: 2.7, totalCarbohydratesG: 28, totalFatG: 0.3, dietaryFibersG: 0.4, sodiumMg: 1 })`.
  - Trong `meals.service.spec.ts`, mô phỏng theo test `getById` thành công hiện có: kỳ vọng `items[0].food` `toMatchObject({ proteinG, totalCarbohydratesG, totalFatG, dietaryFibersG, sodiumMg })` bằng các giá trị của food giả.
- [ ] **Step 2:** `npx jest src/nutrition/log-food.service.spec.ts src/meal-planning/meals.service.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** thêm các field như phần Interfaces.
- [ ] **Step 4:** chạy lại test như Step 2. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): include core macros in nested food objects`

### Task 6: Kiểm tra toàn bộ

- [ ] **Step 1:** `npm test`. Expected: toàn bộ PASS. So với baseline ở Task 0, không có test nào mới fail.
- [ ] **Step 2:** `npm run build`. Expected: không có lỗi TypeScript.
- [ ] **Step 3:** `git log --oneline feat/meal-splits..HEAD`. Expected: có 5 commit của Task 1–5.
- [ ] **Step 4: Cập nhật issue.** Tick checklist trên issue #6 qua `gh` trong WSL. Chưa push hay mở PR; việc đó thuộc bước hoàn thiện nhánh.
