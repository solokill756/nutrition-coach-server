# Đồng bộ dinh dưỡng: bộ 11 chỉ số (backend + web)

Ngày: 2026-10-18
Repo liên quan:
- Backend: `nutrition-coach-server` (github `solokill756/nutrition-coach-server`), nhánh gốc `feat/meal-splits`
- Web: thư mục `web-meal-splits` (github `solokill756/calorie-counter-web`), nhánh gốc `feat/meal-splits`
- App Flutter `FE-calorie-counter`: **không sửa**, nhưng không được làm hỏng nó.

## 1. Bối cảnh và lý do

Backend lưu và trả về 23 chỉ số dinh dưỡng, nhưng dữ liệu không đồng bộ giữa các module (tổng ngày thiếu fiber, dashboard thiếu nhóm sức khỏe, cảnh báo thiếu phosphorus, phần tạo recipe chỉ thấy 9 chỉ số). Web thì gần như chỉ hiển thị calories/protein/carbs/fat; 13 vitamin–khoáng chất chỉ hiện ở một thẻ trên dashboard.

Người dùng quyết định **thu gọn về 11 chỉ số cần thiết** và làm cho 11 chỉ số này đồng bộ từ backend tới web.

## 2. Bộ 11 chỉ số

| Nhóm | Chỉ số | Vì sao |
|---|---|---|
| Cốt lõi (4) | calories, protein, carbs, fat | nền tảng app đếm calo |
| Sức khỏe (7) | fiber, sugars, sodium, saturatedFat, cholesterol, potassium, phosphorus | được rule theo bệnh (tăng huyết áp, tim mạch, tiểu đường, cholesterol cao, bệnh thận) và cảnh báo sử dụng; phosphorus giữ lại cho rule bệnh thận |

Trong tài liệu này "nhóm sức khỏe" = 7 chỉ số ở hàng thứ hai.

12 chỉ số còn lại (calcium, iron, magnesium, zinc, vitamin A, C, D, E, K, B6, B12, folate) **vẫn giữ nguyên trong database và trong mọi response API hiện có**, chỉ không hiển thị trên web và không sinh cảnh báo nữa.

## 3. Mục tiêu, không phải mục tiêu, điều cấm

**Mục tiêu**
- Mọi chỗ backend tổng hợp/tính toán/cảnh báo theo ngày đều có đủ 11 chỉ số.
- Web hiển thị đủ 11 chỉ số ở: dashboard, diary (tổng ngày), chi tiết món, lúc log món, chi tiết meal + log meal, chi tiết recipe + trình sửa recipe, form tạo/sửa món.

**Không phải mục tiêu (lần này)**
- Ước tính dinh dưỡng bằng AI (`food-prompts.ts`, `food.service.ts` hiện chỉ 5 chỉ số).
- API progress trends, trang stats của web.
- Trang admin recipe, admin food.
- Dòng kết quả tìm món, danh sách staples, quick add, mục tiêu trong profile/onboarding (vẫn chỉ calories + 3 macro).
- Sửa bảng `DailyNutritionSummary` hay trigger ghi vào nó.

**Điều cấm (làm thì coi như hỏng dù chạy được)**
- **Đổi tên hoặc xoá field trong response API hiện có.** App Flutter và web đang đọc đúng các tên hiện tại (`dietaryFibersG`, `sugarsG`, `folate`, `micronutrients`…). Chỉ được **thêm** field.
- Xoá dữ liệu 12 vi chất khỏi database hay khỏi response.
- Cần migration/ALTER TABLE mới. (Repo không có migration; schema patch không nằm trong repo.)

## 4. Backend

### B1. `GET api/dashboard/today`: thêm nhóm sức khỏe
File: `src/dashboard/dashboard.service.ts` (~:191-245), dữ liệu đã có sẵn trong `base.dailyTotals` (`buildDailyTotals` :493-519).

Thêm field mới `healthNutrients` vào response, **giữ nguyên** `macros` và `micronutrients`:

```ts
healthNutrients: {
  fiber:        { current: number; min: number | null; max: number | null; unit: "g" };
  sugars:       { current; min; max; unit: "g" };
  sodium:       { current; min; max; unit: "mg" };
  saturatedFat: { current; min; max; unit: "g" };
  cholesterol:  { current; min; max; unit: "mg" };
  potassium:    { current; min; max; unit: "mg" };
  phosphorus:   { current; min; max; unit: "mg" };
}
```

`min`/`max` lấy từ ngưỡng của user (cùng nguồn mà dashboard-alert đang dùng), `null` khi user không có ngưỡng. `current` làm tròn 1 chữ số thập phân như `macros`.

**Chỉ trả bound theo đúng hướng mà B2 cảnh báo** (để thẻ trên web và `AlertsCard` luôn khớp nhau): fiber, potassium → chỉ `min`; sugars, sodium, saturatedFat, cholesterol, phosphorus → chỉ `max`; bound còn lại luôn `null`. Ví dụ: ngưỡng hệ thống phosphorus `min 700` hay sodium `min 500` của rule huyết áp không được trả ra.

### B2. Cảnh báo dashboard: theo bộ 11
File: `src/dashboard/dashboard-alert.service.ts` (:57-80).

- `MAX_ALERT_RULES`: giữ calories, carbs, fat, sugars, sodium, saturatedFat, cholesterol; **thêm protein và phosphorus** (rule bệnh thận đặt max protein 70 g, max phosphorus 800 mg nhưng hiện không bao giờ cảnh báo).
- `MIN_ALERT_RULES`: giữ protein, fiber, potassium; **bỏ** calcium, iron, magnesium, zinc, vitaminC, vitaminB6, vitaminB12, folate.
- **Cảnh báo max protein chỉ dành cho người có bệnh**: chỉ bật khi ngưỡng protein đến từ rule theo bệnh (`origin = "admin_rule"` hoặc có `sourceConditionKey`, ví dụ bệnh thận max 70 g). Ngưỡng hệ thống (max = 112% mục tiêu protein, có ở mọi user) **không** được sinh cảnh báo max. Cần test cho cả hai trường hợp.
- Một chỉ số có cả rule min và max (protein) phải hoạt động đúng: chỉ cảnh báo hướng nào có ngưỡng và bị vượt.
- `NUTRIENT_PRIORITY` có thể giữ nguyên.
- Hệ quả đã chấp nhận: user trên app Flutter cũng sẽ không còn nhận cảnh báo vi chất (cảnh báo do backend sinh).

### B3. Phần tạo recipe thấy đủ nhóm sức khỏe
File: `src/nutrition/user-context.service.ts`.

- `assembleRecipeGenerationContext` (~:340-420) và `assembleContext` (~:451-480) hiện đọc `DailyNutritionSummary` (thiếu fiber, phosphorus; bảng do nơi khác ghi). **Đổi sang tổng hợp trực tiếp từ LogFood của ngày đó**, cùng cách `DiaryService` đang làm (tái dùng `DiaryService.getDay` hoặc tách hàm tổng hợp dùng chung, builder chọn; chú ý timezone/`dateKey` phải giống diary).
- `todayIntake` và `todaySummary`: thêm `totalFiber`, `totalPhosphorus` (giữ các field cũ).
- `remaining`: thêm `fiberGMinRemaining` (theo ngưỡng min fiber) và `phosphorusMg` (theo ngưỡng max phosphorus), theo đúng kiểu của `potassiumMgMinRemaining`/`sodiumMg`.
- Recipe-builder (`recipe-builder.service.ts` ~:225-263 dòng budget trong prompt, ~:480-562 clamp/verify): đưa fiber min và phosphorus max vào khi user có ngưỡng tương ứng, giống cách đang làm với potassium/sodium.
- `validateNutritionAgainstThresholds` (~:1294-1360): thêm phosphorus (max) nếu đơn giản; builder quyết.
- Không còn đọc `summaryRepo` ở đây thì bỏ inject; không xoá entity `DailyNutritionSummary`.
- Cập nhật spec `user-context.service.spec.ts` (fixtures :46, :97, :121).

### B4. Object `food{}` lồng thiếu macro
- `src/nutrition/log-food.service.ts` ~:418-428: `food{}` trong log item thiếu calories, protein, carbs, fat, fiber, sodium.
- `src/meal-planning/meals.service.ts` ~:200-224: `food{}` trong meal item thiếu protein, carbs, fat, fiber, sodium.

Thêm các field còn thiếu, **đặt tên theo đúng quy ước của chính object đó** (cùng kiểu với các field đang có trong object, ví dụ đang dùng `saturatedFatG` thì thêm `proteinG`…). Chỉ thêm, không đổi tên.

### B5. Đổi `%kcal` sang gam đúng hệ số
File: `src/nutrition/condition-nutrient-unit.service.ts` :41-43. Hiện luôn chia 9. Đổi thành: fat, saturatedFat → 9; carbs, protein, sugars, fiber → 4. Hiện chỉ rule saturatedFat dùng `%kcal` nên kết quả hiện tại không đổi; đây là sửa lỗi tiềm ẩn. Thêm test.

### Ngoài phạm vi phía backend
Lỗi key `folate` của cảnh báo và việc `condition-nutrient-unit` không hỗ trợ vitamin C/E/B6: không sửa, vì vi chất không còn được cảnh báo/dùng.

## 5. Web (`web-meal-splits`)

Tên field đọc từ API giữ nguyên như backend trả về; nếu cần thống nhất trong UI thì map ở tầng `lib/api` / `lib/nutrition.ts`, không yêu cầu backend đổi tên.

### F1. Kiểu dữ liệu (`src/lib/api/types.ts` và liên quan)
- `FoodItem`, `FoodInput`: thêm `phosphorusMg`.
- `LogItem`: thêm 7 chỉ số nhóm sức khỏe (`dietaryFibersG, sugarsG, sodiumMg, saturatedFatG, cholesterolMg, potassiumMg, phosphorusMg`).
- `DiaryDay`, `DiaryRangeDay`: thêm `totalDietaryFibersG, totalSugarsG, totalSodiumMg, totalSaturatedFatG, totalCholesterolMg, totalPotassiumMg, totalPhosphorusMg`.
- `DashboardToday`: thêm `healthNutrients` (B1).
- `RecipeNutrients`: thêm `phosphorusMg`; `recipes/recipe.ts` `NUTRIENT_KEYS` và mapping FoodItem→recipe thêm phosphorus.
- `MealNutritionSummary` đã đủ, không đổi.

### F2. Dashboard
- **Ẩn** `MicronutrientsCard` (không render ở `DashboardPage.tsx:130`; có thể xoá component nếu không còn chỗ dùng).
- Thêm thẻ hiển thị 7 chỉ số nhóm sức khỏe từ `healthNutrients`: giá trị hiện tại kèm ngưỡng (min hoặc max) nếu có, làm nổi khi vượt.
- `AlertsCard` giữ nguyên.

### F3. Diary
`diary/components/DaySummary.tsx`: thêm 7 chỉ số nhóm sức khỏe của tổng ngày (có thể đặt trong phần mở rộng "Thêm dinh dưỡng" giống `RecipeNutrition.tsx`).

### F4. Món ăn
- Chi tiết món `FoodDetailPage.tsx` (FACTS :38-45): thêm phosphorus.
- Lúc log món (`LogFoodPanel` → `MacroPreview`, `QuickLogDialog`, `PlatePanel`): hiển thị thêm 7 chỉ số nhóm sức khỏe đã scale theo khẩu phần, trong phần mở rộng.
- Form tạo/sửa món `FoodForm.tsx`: thêm ô nhập phosphorus.

### F5. Meal
`meals/pages/MealDetailPage.tsx`, `meals/components/MealCard.tsx` (nếu chỗ đủ), `food/components/LogMealPanel.tsx`: hiển thị đủ 11 từ `nutritionSummary` (đã có dữ liệu).

### F6. Recipe
- `recipes/pages/RecipeDetailPage.tsx`: hiển thị đủ 11 từ `nutritionPerServing`.
- `recipes/components/editor/RecipeNutrition.tsx`: thêm phosphorus vào phần "More nutrition".

## 6. Ràng buộc
- Thay đổi API chỉ được thêm field (xem điều cấm).
- Không thêm migration; không đổi schema database.
- Backend: test Jest hiện có phải xanh; thêm test cho B1, B2, B3, B5.
- Web: build + lint + test hiện có phải xanh.
- Làm theo thứ tự: backend trước, web sau (web phụ thuộc `healthNutrients` và các field mới của diary/log).

## 7. Đã quyết bởi người dùng
- Thu gọn về 11 chỉ số ở mục 2, giữ phosphorus.
- 12 vi chất còn lại: giữ dữ liệu, không hiển thị, không cảnh báo.
- Không đổi tên field; chỉ thêm.
- Tạo issue trên GitHub trước khi bắt đầu code.
- Cảnh báo protein quá mức chỉ dành cho người có bệnh (ngưỡng từ rule theo bệnh), không áp cho mọi user.

## 8. Mình (Claude) tự quyết, người dùng có thể đổi
- Tên field mới `healthNutrients` và shape `{current, min, max, unit}` (B1).
- `healthNutrients` chỉ trả bound theo hướng cảnh báo (B1).
- Thêm max phosphorus vào cảnh báo (B2).
- B3 tính từ LogFood thay vì sửa bảng `DailyNutritionSummary`.
- Ngoài phạm vi: AI estimate, progress/stats, admin, search/staples/quick add, mục tiêu profile.
- Issue: 2 issue (1 ở repo backend gồm B1–B5, 1 ở repo web gồm F1–F6), mỗi issue có checklist; issue web ghi phụ thuộc vào issue backend.

## 9. Ghi chú đã kiểm tra trong code
- Diary (`GET api/Diary/:date`, `/range`) đã trả đủ 7 tổng nhóm sức khỏe; web chỉ thiếu kiểu.
- Web log món không gửi giá trị dinh dưỡng; backend tự tính đủ từ Food (`log-food.service.ts` ~:282-292).
- `nutritionPerServing` của recipe đã có `phosphorusMg`.
- Các chỗ gọi recipe-builder đã có `tzOffsetMinutes`, truyền tiếp được vào B3.
- `assembleContext` hiện chỉ được gọi từ spec của nó.
- Ngưỡng hệ thống (`nutrition-calculator.service.ts` `buildDefaultThresholds`): phosphorus chỉ có `min 700`; rule bệnh thận thay bằng `max 800`.

## 10. Để builder quyết
- Tái dùng `DiaryService` hay tách hàm tổng hợp chung (B3).
- Bố cục, component, cách hiển thị ngưỡng/vượt ngưỡng trên web.
- Tạo nhánh mới từ `feat/meal-splits` hay làm trực tiếp.
