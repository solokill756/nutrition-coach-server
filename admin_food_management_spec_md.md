# SPEC 03: Admin Food Management Module

## 1. Mục tiêu

Build chức năng quản lý thực phẩm cho Admin Dashboard.

Admin có thể:
- Xem danh sách thực phẩm.
- Tìm kiếm thực phẩm theo tên.
- Lọc theo category.
- Lọc theo trạng thái verified/unverified.
- Tạo thực phẩm mới.
- Cập nhật thông tin thực phẩm.
- Xác minh thực phẩm.
- Xóa mềm thực phẩm.

Đây là module quan trọng vì dữ liệu `Food` được dùng cho:
- Log bữa ăn.
- Tính calories.
- Tính protein/carbs/fat.
- Gợi ý recipe.
- So sánh thực phẩm từ AI/embedding nếu có.

---

# 2. Scope

## Làm trong spec này

- Backend CRUD Food cho admin.
- API pagination/search/filter.
- API verify food.
- Frontend Food list page.
- Frontend create/edit food modal hoặc page.
- Frontend delete confirm.
- Frontend verify action.
- Loading/error/empty state.

## Không làm trong spec này

- Không build Category CRUD chi tiết.
- Không build Recipe CRUD.
- Không build AI food recognition.
- Không build import CSV.
- Không build food embedding.
- Không build user-created food approval nâng cao.

---

# 3. Database table

Sử dụng bảng hiện tại:

```txt
Food
```

Các field chính:

```txt
Id
food_name
ServingUnit
Category
FiberG
Calories
ProteinG
TotalCarbohydratesG
TotalFatG
SodiumMg
ServingSize
CreatedAt
UpdatedAt
IsVerified
UserId
```

---

# 4. Migration requirement

Nếu bảng `Food` chưa có `DelFlag`, thêm migration:

```sql
ALTER TABLE "Food"
ADD COLUMN IF NOT EXISTS "DelFlag" boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS "IX_Food_DelFlag"
ON "Food" ("DelFlag");
```

Lý do:
- Không nên hard delete food vì food có thể đã được dùng trong `LogFood`, `MealFood`, `UserStapleFood`.
- Xóa mềm giúp tránh lỗi foreign key và giữ lịch sử dữ liệu.

---

# 5. Backend APIs

## 5.1 Get food list

```http
GET /admin/foods
```

### Query params

```txt
page=1
limit=20
keyword=chicken
category=meat
isVerified=true
sortBy=createdAt
sortOrder=desc
```

### Query validation

```ts
page?: number >= 1
limit?: number >= 1, max 100
keyword?: string
category?: string
isVerified?: boolean
sortBy?: 'createdAt' | 'foodName' | 'calories' | 'proteinG'
sortOrder?: 'asc' | 'desc'
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "foodName": "Chicken breast",
      "servingUnit": "g",
      "category": "meat",
      "servingSize": 100,
      "calories": 165,
      "proteinG": 31,
      "totalCarbohydratesG": 0,
      "totalFatG": 3.6,
      "fiberG": 0,
      "sodiumMg": 74,
      "isVerified": true,
      "createdAt": "2026-05-24T00:00:00.000Z",
      "updatedAt": "2026-05-24T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

## 5.2 Get food detail

```http
GET /admin/foods/:id
```

### Response

```json
{
  "success": true,
  "data": {
    "id": 1,
    "foodName": "Chicken breast",
    "servingUnit": "g",
    "category": "meat",
    "servingSize": 100,
    "calories": 165,
    "proteinG": 31,
    "totalCarbohydratesG": 0,
    "totalFatG": 3.6,
    "fiberG": 0,
    "sodiumMg": 74,
    "isVerified": true,
    "userId": null,
    "createdAt": "2026-05-24T00:00:00.000Z",
    "updatedAt": "2026-05-24T00:00:00.000Z"
  }
}
```

### Error

Nếu không tìm thấy:

```json
{
  "success": false,
  "error": {
    "code": "FOOD_NOT_FOUND",
    "message": "Food not found"
  }
}
```

---

## 5.3 Create food

```http
POST /admin/foods
```

### Request body

```json
{
  "foodName": "Chicken breast",
  "servingUnit": "g",
  "category": "meat",
  "servingSize": 100,
  "calories": 165,
  "proteinG": 31,
  "totalCarbohydratesG": 0,
  "totalFatG": 3.6,
  "fiberG": 0,
  "sodiumMg": 74,
  "isVerified": true
}
```

### Validation

```ts
foodName: required, string, max 255
servingUnit: required, string, default 'g'
category: optional, string
servingSize: required, number, > 0
calories: required, number, >= 0
proteinG: required, number, >= 0
totalCarbohydratesG: required, number, >= 0
totalFatG: required, number, >= 0
fiberG: optional, number, >= 0
sodiumMg: optional, number, >= 0
isVerified: optional, boolean, default true
```

### Business logic

- Normalize foodName trim.
- Check duplicate by foodName.
- Nếu trùng tên food chưa bị xóa → trả `FOOD_NAME_ALREADY_EXISTS`.
- Admin-created food mặc định `UserId = null`.
- Nếu không truyền `isVerified`, default `true`.

### Response

```json
{
  "success": true,
  "message": "Food created successfully",
  "data": {
    "id": 1,
    "foodName": "Chicken breast"
  }
}
```

---

## 5.4 Update food

```http
PATCH /admin/foods/:id
```

### Request body

Tất cả field optional:

```json
{
  "foodName": "Chicken breast cooked",
  "servingUnit": "g",
  "category": "meat",
  "servingSize": 100,
  "calories": 170,
  "proteinG": 32,
  "totalCarbohydratesG": 0,
  "totalFatG": 4,
  "fiberG": 0,
  "sodiumMg": 80,
  "isVerified": true
}
```

### Business logic

- Check food tồn tại và `DelFlag = false`.
- Nếu update foodName, check duplicate.
- Update `UpdatedAt`.
- Return DTO, không return entity trực tiếp.

### Response

```json
{
  "success": true,
  "message": "Food updated successfully",
  "data": {
    "id": 1,
    "foodName": "Chicken breast cooked"
  }
}
```

---

## 5.5 Delete food

```http
DELETE /admin/foods/:id
```

### Business logic

- Check food tồn tại.
- Set `DelFlag = true`.
- Không hard delete.
- Không xóa các log cũ liên quan đến food.

### Response

```json
{
  "success": true,
  "message": "Food deleted successfully"
}
```

---

## 5.6 Verify food

```http
PATCH /admin/foods/:id/verify
```

### Request body

```json
{
  "isVerified": true
}
```

### Business logic

- Check food tồn tại.
- Update `IsVerified`.

### Response

```json
{
  "success": true,
  "message": "Food verification status updated successfully",
  "data": {
    "id": 1,
    "isVerified": true
  }
}
```

---

# 6. Auth requirement

Tất cả API trong spec này bắt buộc:

```txt
JWT required
Role = admin required
Status = 1 required
```

Nếu user bị block hoặc không phải admin thì không được gọi API.

---

# 7. Backend folder structure

```txt
BE/src/modules/admin/
  foods/
    admin-foods.controller.ts
    admin-foods.service.ts
    dto/
      admin-food-list-query.dto.ts
      admin-food-response.dto.ts
      create-admin-food-request.dto.ts
      update-admin-food-request.dto.ts
      update-food-verify-request.dto.ts
```

Nếu chưa có `FoodEntity`, tạo tại:

```txt
BE/src/modules/foods/entities/food.entity.ts
```

hoặc nơi project đang đặt entity chung.

---

# 8. Backend architecture rule

Bắt buộc theo flow:

```txt
Controller
→ Service
→ TypeORM Repository
→ PostgreSQL
→ DTO Response
```

Không query DB trong Controller.

Không return Entity trực tiếp.

Không tạo custom repository.

Không dùng raw SQL nếu không cần thiết.

Service inject repository:

```ts
@InjectRepository(FoodEntity)
private readonly foodRepo: Repository<FoodEntity>
```

---

# 9. Backend entity mapping note

Database column là:

```txt
food_name
```

Entity nên map camelCase:

```ts
@Column({ type: 'text', name: 'food_name' })
foodName!: string;
```

Các column PascalCase map như sau:

```ts
@Column({ type: 'text', name: 'ServingUnit', default: 'g' })
servingUnit!: string;

@Column({ type: 'text', name: 'Category', nullable: true })
category!: string | null;

@Column({ type: 'double precision', name: 'Calories', default: 0 })
calories!: number;

@Column({ type: 'double precision', name: 'ProteinG', default: 0 })
proteinG!: number;

@Column({ type: 'double precision', name: 'TotalCarbohydratesG', default: 0 })
totalCarbohydratesG!: number;

@Column({ type: 'double precision', name: 'TotalFatG', default: 0 })
totalFatG!: number;

@Column({ type: 'double precision', name: 'FiberG', default: 0 })
fiberG!: number;

@Column({ type: 'double precision', name: 'SodiumMg', default: 0 })
sodiumMg!: number;

@Column({ type: 'double precision', name: 'ServingSize', default: 100 })
servingSize!: number;

@Column({ type: 'boolean', name: 'IsVerified', default: false })
isVerified!: boolean;
```

---

# 10. Frontend route

```txt
/admin/foods
```

Page này nằm trong `AdminLayout`.

Nếu chưa login → redirect `/admin/login`.

---

# 11. Frontend folder structure

```txt
admin-web/src/modules/foods/
  api/
    adminFoodsApi.ts
  pages/
    AdminFoodsPage.tsx
  components/
    FoodFormModal.tsx
    FoodFilterBar.tsx
    FoodTable.tsx
    FoodVerifyBadge.tsx
  hooks/
    useAdminFoods.ts
  types/
    adminFood.types.ts
```

---

# 12. Frontend page UI

## Page title

```txt
Food Management
```

## Page actions

```txt
[Add Food]
```

## Filter bar

Fields:
- Search input: food name
- Category select/input
- Verified select:
  - All
  - Verified
  - Unverified
- Sort select:
  - Newest
  - Oldest
  - Name A-Z
  - Calories high-low
  - Protein high-low

---

# 13. Food table columns

```txt
Name
Category
Serving
Calories
Protein
Carbs
Fat
Sodium
Verified
Updated At
Actions
```

## Actions

```txt
View/Edit
Verify/Unverify
Delete
```

---

# 14. Food form fields

Form dùng cho create và edit.

```txt
Food name *
Category
Serving size *
Serving unit *
Calories *
Protein (g) *
Carbohydrates (g) *
Fat (g) *
Fiber (g)
Sodium (mg)
Verified
```

## UI validation

- Required field hiển thị lỗi inline.
- Numeric field không cho nhập số âm.
- Serving size phải lớn hơn 0.
- Submit button disabled khi form invalid hoặc đang loading.

---

# 15. Delete confirmation

Khi bấm delete, show confirm dialog:

```txt
Are you sure you want to delete this food?
This action will hide the food from admin lists but will not remove existing user logs.
```

Buttons:
- Cancel
- Delete

---

# 16. UI states

## Loading list

```txt
Loading foods...
```

## Empty state

```txt
No foods found.
```

## Error state

```txt
Failed to load foods.
[Retry]
```

## Success toast

```txt
Food created successfully
Food updated successfully
Food deleted successfully
Food verification status updated successfully
```

## Error toast

```txt
Unable to save food
Unable to delete food
Food name already exists
```

---

# 17. Frontend API functions

```ts
getAdminFoods(query): Promise<AdminFoodListResponse>
getAdminFoodDetail(id): Promise<AdminFoodDetailResponse>
createAdminFood(payload): Promise<AdminFoodWriteResponse>
updateAdminFood(id, payload): Promise<AdminFoodWriteResponse>
deleteAdminFood(id): Promise<AdminFoodDeleteResponse>
updateAdminFoodVerify(id, payload): Promise<AdminFoodVerifyResponse>
```

---

# 18. Frontend types

```ts
export type AdminFood = {
  id: number;
  foodName: string;
  servingUnit: string;
  category: string | null;
  servingSize: number;
  calories: number;
  proteinG: number;
  totalCarbohydratesG: number;
  totalFatG: number;
  fiberG: number;
  sodiumMg: number;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminFoodListQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  category?: string;
  isVerified?: boolean;
  sortBy?: 'createdAt' | 'foodName' | 'calories' | 'proteinG';
  sortOrder?: 'asc' | 'desc';
};

export type AdminFoodFormValues = {
  foodName: string;
  servingUnit: string;
  category?: string;
  servingSize: number;
  calories: number;
  proteinG: number;
  totalCarbohydratesG: number;
  totalFatG: number;
  fiberG?: number;
  sodiumMg?: number;
  isVerified?: boolean;
};
```

---

# 19. Pagination behavior

- Default page = 1.
- Default limit = 20.
- Khi search/filter thay đổi → reset page về 1.
- Khi delete item cuối của page hiện tại → refetch và nếu page rỗng thì lùi về page trước.

---

# 20. Error handling

Backend error codes:

```txt
FOOD_NOT_FOUND
FOOD_NAME_ALREADY_EXISTS
VALIDATION_ERROR
UNAUTHORIZED
ADMIN_ONLY
ACCOUNT_BLOCKED
UNKNOWN_ERROR
```

Frontend mapping:

```txt
FOOD_NOT_FOUND → Không tìm thấy thực phẩm
FOOD_NAME_ALREADY_EXISTS → Tên thực phẩm đã tồn tại
VALIDATION_ERROR → Dữ liệu nhập không hợp lệ
UNAUTHORIZED → Phiên đăng nhập đã hết hạn
ADMIN_ONLY → Bạn không có quyền admin
ACCOUNT_BLOCKED → Tài khoản đã bị chặn
UNKNOWN_ERROR → Có lỗi xảy ra, vui lòng thử lại
```

---

# 21. Acceptance criteria

## Backend

- [ ] `GET /admin/foods` hoạt động với pagination.
- [ ] Search theo food name hoạt động.
- [ ] Filter category hoạt động.
- [ ] Filter verified/unverified hoạt động.
- [ ] Sort hoạt động.
- [ ] `GET /admin/foods/:id` hoạt động.
- [ ] `POST /admin/foods` tạo food mới.
- [ ] Không tạo food trùng tên.
- [ ] `PATCH /admin/foods/:id` cập nhật food.
- [ ] `DELETE /admin/foods/:id` soft delete food.
- [ ] `PATCH /admin/foods/:id/verify` update verified status.
- [ ] Tất cả API require admin.
- [ ] Controller không query DB trực tiếp.
- [ ] Response không return entity trực tiếp.

## Frontend

- [ ] `/admin/foods` hiển thị trong AdminLayout.
- [ ] Food table hiển thị đúng dữ liệu.
- [ ] Search hoạt động.
- [ ] Filter hoạt động.
- [ ] Pagination hoạt động.
- [ ] Add food hoạt động.
- [ ] Edit food hoạt động.
- [ ] Delete food có confirm dialog.
- [ ] Verify/unverify hoạt động.
- [ ] Loading state có.
- [ ] Empty state có.
- [ ] Error state có.
- [ ] Toast success/error có.

---

# 22. Không làm trong spec này

- Không build Category Management CRUD.
- Không build Recipe Management.
- Không build Exercise Management.
- Không build User Management.
- Không build AI recognition.
- Không build import/export file.

---

# 23. Final agent summary format

Sau khi implement xong, agent phải báo cáo:

```txt
Implemented:
- ...

Backend files touched:
- ...

Frontend files touched:
- ...

Migrations:
- ...

Security:
- ...

Tested:
- ...

Known limitations / TODO:
- ...
```

