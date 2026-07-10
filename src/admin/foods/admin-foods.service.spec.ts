import { Repository } from "typeorm";
import { FoodNutritionEntity } from "../../meal-planning/entities/food-nutrition.entity";
import { AdminFoodException } from "./admin-foods.exception";
import { AdminFoodsService } from "./admin-foods.service";

type MockRepository = Pick<Repository<FoodNutritionEntity>, "create" | "createQueryBuilder" | "findOne" | "save">;

const makeFood = (overrides: Partial<FoodNutritionEntity> = {}): FoodNutritionEntity => ({
  id: 1,
  foodName: "Chicken breast",
  userId: null,
  category: "meat",
  fdcId: null,
  calories: 165,
  protein: 31,
  carbs: 0,
  fat: 3.6,
  saturatedFat: null,
  cholesterol: null,
  fiber: 0,
  sugars: null,
  sodium: 74,
  potassium: null,
  calcium: null,
  iron: null,
  magnesium: null,
  phosphorus: null,
  zinc: null,
  vitaminA: null,
  vitaminC: null,
  vitaminD: null,
  vitaminE: null,
  vitaminK: null,
  vitaminB6: null,
  vitaminB12: null,
  folateDfe: null,
  servingSize: 100,
  servingUnit: "g",
  servingsPerContainer: 1,
  isVerified: true,
  delFlag: false,
  createdAt: new Date("2026-05-24T00:00:00.000Z"),
  updatedAt: new Date("2026-05-24T00:00:00.000Z"),
  ...overrides,
});

const makeQueryBuilder = (rows: FoodNutritionEntity[] = [], count = rows.length, one: FoodNutritionEntity | null = null) => {
  const qb = {
    clone: jest.fn(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(count),
    getMany: jest.fn().mockResolvedValue(rows),
    getOne: jest.fn().mockResolvedValue(one),
  };
  qb.clone.mockReturnValue(qb);
  return qb;
};

const buildService = (repoOverrides: Partial<MockRepository> = {}) => {
  const repo: MockRepository = {
    create: jest.fn((entity: Partial<FoodNutritionEntity>) => entity as FoodNutritionEntity),
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(async (entity: FoodNutritionEntity) => entity),
    ...repoOverrides,
  };
  return {
    repo,
    service: new AdminFoodsService(repo as Repository<FoodNutritionEntity>),
  };
};

describe("AdminFoodsService", () => {
  it("lists foods with pagination, search, filters, and sort", async () => {
    const qb = makeQueryBuilder([makeFood()], 1);
    const { repo, service } = buildService({
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    });

    const response = await service.list({
      page: 2,
      limit: 10,
      keyword: "chicken",
      category: "meat",
      isVerified: true,
      sortBy: "proteinG",
      sortOrder: "desc",
    });

    expect(response.pagination).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
    expect(response.data[0]).toMatchObject({ foodName: "Chicken breast", proteinG: 31 });
    expect(repo.createQueryBuilder).toHaveBeenCalledWith("food");
    expect(qb.where).toHaveBeenCalledWith("food.delFlag = :delFlag", { delFlag: false });
    expect(qb.andWhere).toHaveBeenCalledWith("food.foodName ILIKE :keyword", { keyword: "%chicken%" });
    expect(qb.andWhere).toHaveBeenCalledWith("food.category = :category", { category: "meat" });
    expect(qb.andWhere).toHaveBeenCalledWith("food.isVerified = :isVerified", { isVerified: true });
    expect(qb.clone).toHaveBeenCalledTimes(2);
    expect(qb.select).toHaveBeenCalledWith(expect.arrayContaining(["food.id", "food.foodName", "food.calories"]));
    expect(qb.orderBy).toHaveBeenCalledWith("food.protein", "DESC");
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(10);
  });

  it("returns detail and rejects deleted or missing food", async () => {
    const food = makeFood();
    const { repo, service } = buildService({
      findOne: jest.fn().mockResolvedValueOnce(food).mockResolvedValueOnce(null),
    });

    await expect(service.detail(1)).resolves.toMatchObject({
      success: true,
      data: { id: 1, userId: null, foodName: "Chicken breast" },
    });
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 1, delFlag: false } });
    await expect(service.detail(2)).rejects.toMatchObject({ code: "FOOD_NOT_FOUND" });
  });

  it("creates admin food with defaults and rejects duplicate active names", async () => {
    const duplicateQb = makeQueryBuilder([], 0, null);
    const { repo, service } = buildService({
      createQueryBuilder: jest.fn().mockReturnValue(duplicateQb),
      save: jest.fn(async (entity: FoodNutritionEntity) => ({ ...entity, id: 9 })),
    });

    await expect(
      service.create({
        foodName: " Chicken breast ",
        servingUnit: " g ",
        category: " meat ",
        servingSize: 100,
        calories: 165,
        proteinG: 31,
        totalCarbohydratesG: 0,
        totalFatG: 3.6,
        potassiumMg: 256,
        vitaminCMg: 2,
      }),
    ).resolves.toEqual({
      success: true,
      message: "Food created successfully",
      data: { id: 9, foodName: "Chicken breast" },
    });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      foodName: "Chicken breast",
      servingUnit: "g",
      category: "meat",
      userId: null,
      isVerified: true,
      delFlag: false,
      potassium: 256,
      vitaminC: 2,
    }));

    const duplicateService = buildService({
      createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder([], 0, makeFood())),
    }).service;
    await expect(
      duplicateService.create({
        foodName: "Chicken breast",
        servingUnit: "g",
        servingSize: 100,
        calories: 165,
        proteinG: 31,
        totalCarbohydratesG: 0,
        totalFatG: 3.6,
      }),
    ).rejects.toBeInstanceOf(AdminFoodException);
  });

  it("updates food, checks duplicate names, soft deletes, and verifies", async () => {
    const existing = makeFood();
    const { repo, service } = buildService({
      createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder([], 0, null)),
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (entity: FoodNutritionEntity) => entity),
    });

    await expect(service.update(1, { foodName: "Cooked chicken", calories: 170 })).resolves.toMatchObject({
      message: "Food updated successfully",
      data: { id: 1, foodName: "Cooked chicken" },
    });
    expect(existing.calories).toBe(170);
    expect(existing.updatedAt).toBeInstanceOf(Date);

    await expect(service.softDelete(1)).resolves.toEqual({
      success: true,
      message: "Food deleted successfully",
    });
    expect(existing.delFlag).toBe(true);

    existing.delFlag = false;
    await expect(service.updateVerify(1, { isVerified: false })).resolves.toEqual({
      success: true,
      message: "Food verification status updated successfully",
      data: { id: 1, isVerified: false },
    });
    expect(repo.save).toHaveBeenCalled();
  });
});
