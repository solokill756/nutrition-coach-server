import { NotFoundException } from "@nestjs/common";
import { FoodController } from "./food.controller";

function createController() {
  const foodRepo: any = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(async (row) => row),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const foodService: any = {
    createFood: jest.fn(),
    searchFood: jest.fn(),
  };
  const usda: any = { searchAndSync: jest.fn().mockResolvedValue([]) };
  const controller = new FoodController(foodRepo, foodService, usda);
  return { controller, foodRepo, foodService, usda };
}

function createQb(rows: unknown[] = [], count = rows.length) {
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getMany: jest.fn().mockResolvedValue(rows),
    getCount: jest.fn().mockResolvedValue(count),
  };
  return qb;
}

describe("FoodController delete/history safety", () => {
  it("soft deletes user-created food instead of hard deleting it", async () => {
    const { controller, foodRepo } = createController();
    const food = {
      id: 10,
      userId: 7,
      foodName: "Custom rice",
      delFlag: false,
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    };
    foodRepo.findOne.mockResolvedValueOnce(food);

    const out = await controller.remove({ user: { userId: 7 } } as any, 10);

    expect(out).toEqual({ message: "OK", statusCode: 200 });
    expect(food.delFlag).toBe(true);
    expect(food.updatedAt).toBeInstanceOf(Date);
    expect(foodRepo.save).toHaveBeenCalledWith(food);
    expect(foodRepo.delete).not.toHaveBeenCalled();
  });

  it("does not delete food owned by another user, missing, or already deleted", async () => {
    const { controller, foodRepo } = createController();
    foodRepo.findOne.mockResolvedValueOnce(null);

    await expect(controller.remove({ user: { userId: 7 } } as any, 10)).rejects.toBeInstanceOf(NotFoundException);
    expect(foodRepo.save).not.toHaveBeenCalled();
    expect(foodRepo.delete).not.toHaveBeenCalled();
  });

  it("excludes deleted foods from ids lookup", async () => {
    const { controller, foodRepo } = createController();
    foodRepo.find.mockResolvedValueOnce([
      {
        id: 1,
        foodName: "Rice",
        calories: 100,
        protein: 2,
        carbs: 20,
        fat: 0,
        servingSize: 100,
        servingUnit: "g",
        isVerified: true,
      },
    ]);

    const out = await controller.list(
      { user: { userId: 7 } } as any,
      1,
      10,
      undefined,
      undefined,
      undefined,
      "1,2",
    );

    expect(foodRepo.find).toHaveBeenCalledWith({
      where: expect.objectContaining({ delFlag: false }),
    });
    expect(out.total).toBe(1);
  });

  it("adds delFlag filter to normal food list query", async () => {
    const { controller, foodRepo } = createController();
    const qb = createQb([], 0);
    foodRepo.createQueryBuilder.mockReturnValueOnce(qb);

    await controller.list({ user: { userId: 7 } } as any, 1, 10);

    expect(qb.where).toHaveBeenCalledWith("f.delFlag = :delFlag", { delFlag: false });
  });

  it("filters getById by delFlag", async () => {
    const { controller, foodRepo } = createController();
    foodRepo.findOne.mockResolvedValueOnce(null);

    await expect(controller.getById(10)).rejects.toBeInstanceOf(NotFoundException);
    expect(foodRepo.findOne).toHaveBeenCalledWith({ where: { id: 10, delFlag: false } });
  });

  it("filters update by owner and delFlag", async () => {
    const { controller, foodRepo } = createController();
    foodRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      controller.update({ user: { userId: 7 } } as any, 10, { calories: 200 } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(foodRepo.findOne).toHaveBeenCalledWith({ where: { id: 10, userId: 7, delFlag: false } });
  });
});

describe("FoodController create/update food library", () => {
  it("creates user food through FoodService and returns API item", async () => {
    const { controller, foodService } = createController();
    const savedFood = {
      id: 31,
      foodName: "Custom oats",
      category: null,
      calories: 180,
      protein: 6,
      carbs: 30,
      fat: 4,
      servingSize: 100,
      servingUnit: "g",
      isVerified: false,
    };
    foodService.createFood.mockResolvedValueOnce(savedFood);

    const out = await controller.create(
      { user: { userId: 7 } } as any,
      {
        description: "Custom oats",
        calories: 180,
        proteinG: 6,
        totalCarbohydratesG: 30,
        totalFatG: 4,
      } as any,
    );

    expect(foodService.createFood).toHaveBeenCalledWith(7, expect.objectContaining({ description: "Custom oats" }));
    expect(out).toMatchObject({ id: 31, foodName: "Custom oats", calories: 180, proteinG: 6 });
  });
});

describe("FoodController external search", () => {
  const usdaBanana = {
    id: 41,
    foodName: "Bananas, raw",
    category: "USDA Foundation",
    fdcId: 1105314,
    calories: 89,
    protein: 1.09,
    carbs: 22.84,
    fat: 0.33,
    servingSize: 100,
    servingUnit: "g",
    servingsPerContainer: 1,
    isVerified: true,
  };

  it("returns USDA foods when the database has no match", async () => {
    const { controller, foodRepo, foodService, usda } = createController();
    foodRepo.createQueryBuilder.mockReturnValueOnce(createQb([], 0));
    usda.searchAndSync.mockResolvedValueOnce([usdaBanana]);

    const out: any = await controller.list(
      { user: { userId: 7 } } as any, 1, 20, undefined, "banana", undefined, undefined, "true",
    );

    expect(usda.searchAndSync).toHaveBeenCalledWith("banana", 20);
    expect(foodService.searchFood).not.toHaveBeenCalled();
    expect(out.total).toBe(1);
    expect(out.items[0]).toMatchObject({ id: 41, fdcId: 1105314, foodName: "Bananas, raw", calories: 89 });
  });

  it("does not call USDA unless external search is allowed", async () => {
    const { controller, foodRepo, usda } = createController();
    foodRepo.createQueryBuilder.mockReturnValueOnce(createQb([], 0));

    await controller.list({ user: { userId: 7 } } as any, 1, 20, undefined, "banana");

    expect(usda.searchAndSync).not.toHaveBeenCalled();
  });
});
