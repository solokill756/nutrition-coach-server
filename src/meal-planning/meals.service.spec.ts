import { NotFoundException } from "@nestjs/common";
import { MealsService } from "./meals.service";

describe("MealsService", () => {
  function setup() {
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      getOne: jest.fn(),
      getMany: jest.fn(),
      getCount: jest.fn().mockResolvedValue(0),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
    };
    const mealRepo: any = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: x.id ?? 1, ...x })),
    };
    const mealFoodRepo: any = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: x.id ?? 99, ...x })),
      findOne: jest.fn(),
      delete: jest.fn(),
    };
    const foodRepo: any = { find: jest.fn().mockResolvedValue([]) };
    const service = new MealsService(mealRepo, mealFoodRepo, foodRepo);
    return { service, mealRepo, mealFoodRepo, foodRepo, qb };
  }

  it("getById throws when meal not readable", async () => {
    const { service, qb } = setup();
    qb.getOne.mockResolvedValueOnce(null);
    await expect(service.getById(1, 5)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("create and list success", async () => {
    const { service, qb, mealRepo } = setup();
    qb.getMany.mockResolvedValueOnce([{ id: 1 }]);
    qb.getOne.mockResolvedValue({ id: 1, userId: 1, name: "A", shareWith: 1, delFlag: false, createdAt: new Date(), updatedAt: new Date() });
    const created = await service.create(1, { name: "  Meal A  " } as any);
    expect(created.name).toBe("A");

    mealRepo.createQueryBuilder.mockReturnValueOnce(qb);
    const listed = await service.list(1, "A", true);
    expect(Array.isArray(listed.items)).toBe(true);
  });

  it("update/remove owner guards", async () => {
    const { service, mealRepo, qb } = setup();
    mealRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.update(1, 3, { name: "B" } as any)).rejects.toBeInstanceOf(NotFoundException);

    mealRepo.findOne.mockResolvedValueOnce({ id: 3, userId: 1, name: "A", shareWith: 1, delFlag: false });
    await expect(service.remove(1, 3)).resolves.toEqual({ message: "OK", statusCode: 200 });
    expect(mealRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 3, delFlag: true }));

    qb.getOne.mockResolvedValueOnce({ id: 3, userId: 1, name: "A", shareWith: 1, delFlag: false, createdAt: new Date(), updatedAt: new Date() });
    mealRepo.findOne.mockResolvedValueOnce({ id: 3, userId: 1, name: "A", shareWith: 1, delFlag: false });
    const updated = await service.update(1, 3, { directions: "cook" } as any);
    expect(updated.id).toBe(3);
  });

  it("add/update/remove item and copyPrevious", async () => {
    const { service, mealRepo, mealFoodRepo, qb } = setup();
    mealRepo.findOne.mockResolvedValue({ id: 7, userId: 1, name: "X", shareWith: 1, delFlag: false });
    qb.getOne.mockResolvedValue({ id: 7, userId: 1, name: "X", shareWith: 1, delFlag: false, createdAt: new Date(), updatedAt: new Date() });

    await service.addItem(1, 7, { foodId: 10, quantity: 2 } as any);

    mealFoodRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.updateItem(1, 7, 99, { quantity: 3 } as any)).rejects.toBeInstanceOf(NotFoundException);

    mealFoodRepo.findOne.mockResolvedValueOnce({ id: 99, mealId: 7, quantity: "1", order: 0, unit: null });
    await service.updateItem(1, 7, 99, { quantity: 3, unit: "g" } as any);

    await service.removeItem(1, 7, 99);

    mealRepo.findOne
      .mockResolvedValueOnce({ id: 7, userId: 1, name: "X", shareWith: 2, directions: "d", imageUrl: null, delFlag: false })
      .mockResolvedValueOnce({ id: 8, userId: 1, name: "Copy", shareWith: 2, delFlag: false });
    mealFoodRepo.find.mockResolvedValueOnce([{ id: 1, foodId: 10, quantity: "2", order: 0, unit: "g" }]);
    qb.getOne.mockResolvedValue({ id: 8, userId: 1, name: "Copy", shareWith: 2, delFlag: false, createdAt: new Date(), updatedAt: new Date() });
    const copied = await service.copyPrevious(1, { sourceMealId: 7, name: "Copy" } as any);
    expect(copied.id).toBe(8);
  });
  it("keeps soft-deleted meals hidden from library reads", async () => {
    const { service, qb } = setup();
    qb.getOne.mockResolvedValueOnce(null);

    await expect(service.getById(1, 3)).rejects.toBeInstanceOf(NotFoundException);
    expect(qb.andWhere).toHaveBeenCalledWith("m.delFlag = false");
  });

  it("filters community meal list by active shared meals only", async () => {
    const { service, qb } = setup();
    qb.getMany.mockResolvedValueOnce([]);

    await service.list(2, undefined, true);

    expect(qb.where).toHaveBeenCalledWith("m.delFlag = false");
    expect(qb.andWhere).toHaveBeenCalledWith("(m.userId = :userId OR m.shareWith = 2)", { userId: 2 });
  });
});
