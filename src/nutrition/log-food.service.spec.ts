import { BadRequestException, NotFoundException } from "@nestjs/common";
import { LogFoodService } from "./log-food.service";

function createQb(getOneValue: unknown = null, getManyAndCountValue: [unknown[], number] = [[], 0]) {
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    leftJoin: jest.fn(() => qb),
    getOne: jest.fn().mockResolvedValue(getOneValue),
    getManyAndCount: jest.fn().mockResolvedValue(getManyAndCountValue),
  };
  return qb;
}

function createService() {
  const qb = createQb();
  const logRepo: any = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 100, ...x })),
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(),
  };
  const foodRepo: any = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  };
  const mealRepo: any = {
    createQueryBuilder: jest.fn(() => createQb(null)),
  };

  const service = new LogFoodService(logRepo, foodRepo, mealRepo);
  return { service, logRepo, foodRepo, mealRepo, qb };
}

describe("LogFoodService", () => {
  it("creates quick-add log", async () => {
    const { service } = createService();
    const result = await service.create(1, {
      type: "quick_add",
      meal: "lunch",
      calories: 200,
      proteinG: 12,
      totalCarbohydratesG: 20,
      totalFatG: 8,
    });
    expect(result.id).toBe(100);
  });

  it("throws when regular log has no foodId and no mealId", async () => {
    const { service } = createService();
    await expect(service.create(1, { type: "regular", meal: "dinner" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws when regular log food not found", async () => {
    const { service, foodRepo } = createService();
    foodRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.create(1, { type: "regular", foodId: 99 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("creates regular log from food snapshot", async () => {
    const { service, foodRepo } = createService();
    foodRepo.findOne.mockResolvedValueOnce({
      id: 10,
      foodName: "Chicken breast",
      calories: 100,
      protein: 20,
      carbs: 0,
      fat: 2,
      sodium: 50,
      fiber: 0,
      sugars: 0,
      saturatedFat: 0.5,
      cholesterol: 60,
      potassium: 200,
      servingSize: 100,
      servingUnit: "g",
    });
    const result = await service.create(1, {
      type: "regular",
      foodId: 10,
      numberOfServings: 2,
      servingSize: 100,
      meal: "breakfast",
    });
    expect(result.id).toBe(100);
  });

  it("creates regular log from meal snapshot when mealId is provided", async () => {
    const { service, mealRepo } = createService();
    mealRepo.createQueryBuilder.mockReturnValueOnce(createQb({ id: 5, name: "Meal A" }));
    const result = await service.create(1, {
      type: "regular",
      mealId: 5,
      meal: "snack",
      calories: 300,
    });
    expect(result.id).toBe(100);
  });

  it("list returns mapped rows", async () => {
    const { service, qb, logRepo } = createService();
    const row = {
      id: 1,
      foodId: null,
      foodName: "Quick add",
      mealId: null,
      recipeId: null,
      type: 2,
      loggedAt: new Date("2026-05-31T10:00:00.000Z"),
      meal: 1,
      mealType: "breakfast",
      numberOfServings: "1",
      servingSize: "1",
      unit: "meal",
      calories: "120",
      totalCarbohydratesG: "10",
      proteinG: "5",
      totalFatG: "3",
      sodiumMg: "20",
      dietaryFibersG: "2",
      sugarsG: "1",
      saturatedFatG: "1",
      cholesterolMg: "0",
      potassiumMg: "100",
    };
    qb.getManyAndCount.mockResolvedValueOnce([[row], 1]);
    logRepo.createQueryBuilder.mockReturnValueOnce(qb);
    const out = await service.list(1, "2026-05-31", "2026-05-31");
    expect(out.total).toBe(1);
    expect((out.items[0] as any).foodName).toBe("Quick add");
  });

  it("softDelete marks row as deleted", async () => {
    const { service, logRepo } = createService();
    logRepo.findOne.mockResolvedValueOnce({ id: 77, delFlag: false });
    await service.softDelete(1, 77);
    expect(logRepo.save).toHaveBeenCalled();
  });

  it("softDelete throws when row missing", async () => {
    const { service, logRepo } = createService();
    logRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.softDelete(1, 88)).rejects.toBeInstanceOf(NotFoundException);
  });

  // Task 2 regression tests
  it("does not create a new regular log from a soft-deleted food", async () => {
    const { service, foodRepo } = createService();
    foodRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.create(2, {
        type: "regular",
        foodId: 99,
        meal: "lunch",
        numberOfServings: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(foodRepo.findOne).toHaveBeenCalledWith({ where: { id: 99, delFlag: false } });
  });

  it("mapRowsToApiItems preserves snapshot fields when linked food is deleted or missing", async () => {
    const { service, foodRepo } = createService();
    foodRepo.find.mockResolvedValueOnce([]);
    const row = {
      id: 21,
      userId: 2,
      foodId: 99,
      foodName: "Deleted custom rice",
      mealId: null,
      recipeId: null,
      type: 1,
      loggedAt: new Date("2026-06-07T07:00:00.000Z"),
      meal: 1,
      mealType: "breakfast",
      numberOfServings: "1",
      servingSize: "100",
      unit: "g",
      calories: "180",
      totalCarbohydratesG: "39",
      proteinG: "4",
      totalFatG: "1",
      sodiumMg: "5",
      dietaryFibersG: "2",
      sugarsG: "1",
      saturatedFatG: "0",
      cholesterolMg: "0",
      potassiumMg: "55",
    } as any;

    const items = await service.mapRowsToApiItems([row]);

    expect(foodRepo.find).toHaveBeenCalledWith({ where: { id: expect.any(Object), delFlag: false } });
    expect(items[0]).toMatchObject({
      foodId: 99,
      foodName: "Deleted custom rice",
      calories: 180,
      totalCarbohydratesG: 39,
      proteinG: 4,
      totalFatG: 1,
      food: null,
    });
  });

  it("mapRowsToApiItems includes core macros in nested food", async () => {
    const { service, foodRepo } = createService();
    foodRepo.find.mockResolvedValueOnce([
      { id: 99, foodName: "Rice", category: null, servingUnit: "g", servingSize: 100, calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sodium: 1, isVerified: true },
    ]);
    const row = {
      id: 22, userId: 2, foodId: 99, foodName: "Rice", mealId: null, recipeId: null, type: 1,
      loggedAt: new Date("2026-06-07T07:00:00.000Z"), meal: 1, mealType: "breakfast",
      numberOfServings: "1", servingSize: "100", unit: "g", calories: "130",
    } as any;

    const items = await service.mapRowsToApiItems([row]);

    expect(items[0].food).toMatchObject({
      calories: 130,
      proteinG: 2.7,
      totalCarbohydratesG: 28,
      totalFatG: 0.3,
      dietaryFibersG: 0.4,
      sodiumMg: 1,
    });
  });

  // Task 3 regression tests
  it("list does not filter out logs linked to soft-deleted meal templates", async () => {
    const { service, qb, logRepo } = createService();
    const row = {
      id: 11,
      userId: 2,
      foodId: null,
      foodName: "Deleted meal snapshot",
      mealId: 44,
      recipeId: null,
      type: 1,
      loggedAt: new Date("2026-06-07T12:00:00.000Z"),
      meal: 2,
      mealType: "lunch",
      numberOfServings: "1",
      servingSize: "1",
      unit: "meal",
      calories: "450",
      totalCarbohydratesG: "55",
      proteinG: "22",
      totalFatG: "12",
      sodiumMg: "300",
      dietaryFibersG: "6",
      sugarsG: "4",
      saturatedFatG: "3",
      cholesterolMg: "20",
      potassiumMg: "350",
    };
    qb.getManyAndCount.mockResolvedValueOnce([[row], 1]);
    logRepo.createQueryBuilder.mockReturnValueOnce(qb);

    const out = await service.list(2, "2026-06-07", "2026-06-07");

    expect(out.total).toBe(1);
    expect((out.items[0] as any).mealId).toBe(44);
    expect((out.items[0] as any).foodName).toBe("Deleted meal snapshot");
    expect((out.items[0] as any).calories).toBe(450);
    expect(qb.andWhere).not.toHaveBeenCalledWith(
      "(log.mealId IS NULL OR (meal.id IS NOT NULL AND meal.delFlag = false))",
    );
  });

  it("keeps another user's history when owner deleted the shared meal template", async () => {
    const { service, qb, logRepo } = createService();
    const row = {
      id: 12,
      userId: 2,
      foodId: null,
      foodName: "Owner shared meal snapshot",
      mealId: 77,
      recipeId: null,
      type: 1,
      loggedAt: new Date("2026-06-08T12:00:00.000Z"),
      meal: 2,
      mealType: "lunch",
      numberOfServings: "1",
      servingSize: "1",
      unit: "meal",
      calories: "520",
      totalCarbohydratesG: "60",
      proteinG: "28",
      totalFatG: "16",
      sodiumMg: "400",
      dietaryFibersG: "7",
      sugarsG: "5",
      saturatedFatG: "4",
      cholesterolMg: "30",
      potassiumMg: "420",
    };
    qb.getManyAndCount.mockResolvedValueOnce([[row], 1]);
    logRepo.createQueryBuilder.mockReturnValueOnce(qb);

    const out = await service.list(2, "2026-06-08", "2026-06-08");

    expect(out.total).toBe(1);
    expect((out.items[0] as any).foodName).toBe("Owner shared meal snapshot");
    expect((out.items[0] as any).mealId).toBe(77);
    expect((out.items[0] as any).calories).toBe(520);
  });
});

