import { BadRequestException, NotFoundException } from "@nestjs/common";
import { WeightService } from "./weight.service";

function createService() {
  const nutritionCalculator = {
    normalizeGoalType: jest.fn((v) => v),
    computeNutritionPlan: jest.fn(() => ({ tdee: 2000, targetCalories: 1800 })),
    macroBreakdownFromThresholds: jest.fn(() => null),
    macroBreakdownFromTargetCalories: jest.fn(() => ({ proteinG: 100, carbsG: 200, fatG: 60 })),
    macroBreakdownForGoal: jest.fn(() => ({ proteinG: 100, carbsG: 200, fatG: 60 })),
    buildDefaultThresholds: jest.fn(() => []),
  };

  const thresholdBuilder: any = {
    build: jest.fn().mockResolvedValue([]),
  };

  const thresholdPersistence: any = {
    replaceUserThresholds: jest.fn().mockResolvedValue(undefined),
  };

  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    clone: jest.fn(() => qb),
    getCount: jest.fn().mockResolvedValue(2),
    orderBy: jest.fn(() => qb),
    getOne: jest.fn().mockResolvedValue({
      id: 11, weightKg: "61.0", recordedAt: new Date("2026-06-01T10:00:00.000Z"), recordedOn: "2026-06-01",
    }),
    getMany: jest.fn().mockResolvedValue([
      { id: 10, weightKg: "60.0", recordedAt: new Date("2026-05-31T10:00:00.000Z"), recordedOn: "2026-05-31" },
      { id: 11, weightKg: "61.0", recordedAt: new Date("2026-06-01T10:00:00.000Z"), recordedOn: "2026-06-01" },
    ]),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
  };

  const weightRepo: any = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 99, ...x })),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const userRepo: any = {
    findOne: jest.fn().mockResolvedValue({
      id: 1,
      weight: 60,
      startWeight: 85,
      delFlag: false,
    }),
    save: jest.fn(),
  };
  const goalRepo: any = {
    findOne: jest.fn().mockResolvedValue({ id: 1, userId: 1, isActive: true, goalType: "lose", targetCalories: 2000 }),
    save: jest.fn(),
  };
  const thresholdRepo: any = {
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x) => x),
  };
  const healthRepo: any = {
    find: jest.fn().mockResolvedValue([]),
  };

  // Mock DataSource.transaction to call the callback with a mock EntityManager
  const mockManager: any = {
    getRepository: jest.fn((entity) => {
      if (entity.name === "WeightEntity") return weightRepo;
      if (entity.name === "AppUserEntity") return userRepo;
      if (entity.name === "UserGoalEntity") return goalRepo;
      if (entity.name === "UserNutritionalThresholdEntity") return thresholdRepo;
      if (entity.name === "UserHealthConditionEntity") return healthRepo;
      return weightRepo;
    }),
  };
  const dataSource: any = {
    transaction: jest.fn(async (fn: any) => fn(mockManager)),
  };

  const service = new WeightService(
    dataSource,
    nutritionCalculator as never,
    thresholdBuilder as never,
    thresholdPersistence as never,
    weightRepo,
    userRepo,
    goalRepo,
    thresholdRepo,
  );
  return { service, weightRepo, userRepo, goalRepo, qb, thresholdRepo, dataSource, mockManager, thresholdPersistence };
}

describe("WeightService", () => {
  it("toApiItem maps payload fields", () => {
    const { service } = createService();
    const out = service.toApiItem({
      id: 5,
      weightKg: "62.5",
      recordedAt: new Date("2026-05-31T00:00:00.000Z"),
      photoUrl: null,
    } as never);
    expect(out).toMatchObject({ id: 5, weightKg: 62.5 });
  });

  it("list returns items and stats", async () => {
    const { service } = createService();
    const result = await service.list(1, 1, 10);
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.stats.startValue).toBe(85);
    expect(result.stats.currentValue).toBe(61);
  });

  it("list uses profile weight as current when user has no weight logs", async () => {
    const { service, qb, weightRepo } = createService();
    qb.getCount.mockResolvedValueOnce(0);
    qb.getMany.mockResolvedValueOnce([]);
    weightRepo.createQueryBuilder.mockImplementationOnce(() => qb);
    weightRepo.createQueryBuilder.mockImplementationOnce(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    }));

    const result = await service.list(1, 1, 10);
    expect(result.items).toHaveLength(0);
    expect(result.stats).toEqual({
      startValue: 85,
      currentValue: 85,
      changeValue: 0,
      changePercentage: 0,
    });
  });

  it("getOne throws when row not found", async () => {
    const { service, weightRepo } = createService();
    weightRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.getOne(1, 123)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("saveEntry validates positive weight", async () => {
    const { service } = createService();
    await expect(
      service.saveEntry({
        userId: 1,
        weightKg: 0,
        recordedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("saveEntry uses client calendar day for recordedOn", async () => {
    const { service, weightRepo } = createService();
    weightRepo.findOne.mockResolvedValueOnce(null);
    const recordedAt = new Date("2026-06-17T18:30:00.000Z");
    await service.saveEntry({
      userId: 1,
      weightKg: 60,
      recordedAt,
      tzOffsetMinutes: 420,
    });
    expect(weightRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ recordedOn: "2026-06-18" }),
    );
  });

  it("saveEntry creates new row when not existing", async () => {
    const { service, weightRepo, thresholdPersistence } = createService();
    weightRepo.findOne.mockResolvedValueOnce(null);
    const saved = await service.saveEntry({
      userId: 1,
      weightKg: 60,
      recordedAt: new Date("2026-05-31T09:00:00.000Z"),
    });
    expect(Number(saved.id)).toBeGreaterThan(0);
    expect(weightRepo.save).toHaveBeenCalled();
    expect(thresholdPersistence.replaceUserThresholds).toHaveBeenCalled();
  });

  it("saveEntry update with existingId throws when missing", async () => {
    const { service, weightRepo } = createService();
    weightRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.saveEntry({
        userId: 1,
        existingId: 77,
        weightKg: 60,
        recordedAt: new Date("2026-05-31T09:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("recalculate throws when no active goal", async () => {
    const { service, goalRepo } = createService();
    goalRepo.findOne.mockResolvedValue(null);
    await expect(
      service.saveEntry({
        userId: 1,
        weightKg: 60,
        recordedAt: new Date("2026-05-31T09:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("latestByDay returns latest map by day key", async () => {
    const { service, weightRepo } = createService();
    weightRepo.find.mockResolvedValueOnce([
      { recordedOn: "2026-05-31", weightKg: "60" },
      { recordedOn: "2026-05-31", weightKg: "61" },
      { recordedOn: "2026-06-01", weightKg: "62" },
    ]);
    const m = await service.latestByDay(1, "2026-05-31", "2026-06-01");
    expect(m.get("2026-05-31")).toBe(61);
    expect(m.get("2026-06-01")).toBe(62);
  });

  it("hasEntryOnDate returns boolean from count", async () => {
    const { service, weightRepo } = createService();
    weightRepo.count.mockResolvedValueOnce(1);
    await expect(service.hasEntryOnDate(1, "2026-05-31")).resolves.toBe(true);
  });

  it("create throws on invalid recordedAt", async () => {
    const { service } = createService();
    await expect(
      service.create(
        1,
        { weightKg: "60", recordedAt: "invalid-date" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("update returns ok on success", async () => {
    const { service, weightRepo } = createService();
    weightRepo.findOne.mockResolvedValueOnce({
      id: 9,
      userId: 1,
      delFlag: false,
      weightKg: "59.0",
      recordedAt: new Date("2026-05-31T10:00:00.000Z"),
      recordedOn: "2026-05-31",
    });
    const out = await service.update(
      1,
      9,
      { weightKg: 60, recordedAt: "2026-06-01T10:00:00.000Z" },
    );
    expect(out).toEqual({ ok: true });
  });
});
