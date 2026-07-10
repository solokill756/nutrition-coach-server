import { EntityManager } from "typeorm";
import { ConditionNutrientUnitService } from "./condition-nutrient-unit.service";
import { UserNutritionalThresholdEntity } from "./entities/user-nutritional-threshold.entity";
import { UserThresholdPersistenceService } from "./user-threshold-persistence.service";

describe("UserThresholdPersistenceService", () => {
  const units = new ConditionNutrientUnitService();
  const service = new UserThresholdPersistenceService(units);

  function mockManager(existing: UserNutritionalThresholdEntity[]) {
    const thresholdRepo = {
      find: jest.fn().mockResolvedValue(existing),
      create: jest.fn((x: Partial<UserNutritionalThresholdEntity>) => x),
      save: jest.fn(async (rows: UserNutritionalThresholdEntity[]) => rows),
    };
    const manager = {
      getRepository: jest.fn(() => thresholdRepo),
    } as unknown as EntityManager;
    return { manager, thresholdRepo };
  }

  it("updates existing rows instead of inserting duplicates", async () => {
    const existing = [
      {
        id: 1,
        userId: 7,
        nutrient: "protein",
        minAmount: 90,
        maxAmount: 110,
        unit: "g",
        isActive: true,
        origin: "system",
      } as UserNutritionalThresholdEntity,
    ];
    const { manager, thresholdRepo } = mockManager(existing);

    await service.replaceUserThresholds(manager, 7, [
      {
        nutrient: "protein",
        minAmount: 100,
        maxAmount: 120,
        unit: "g",
        isActive: true,
        origin: "system",
      },
    ]);

    expect(thresholdRepo.create).not.toHaveBeenCalled();
    expect(thresholdRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 1,
        nutrient: "protein",
        minAmount: 100,
        maxAmount: 120,
        isActive: true,
      }),
    ]);
  });

  it("inserts nutrients that do not exist yet", async () => {
    const { manager, thresholdRepo } = mockManager([]);

    await service.replaceUserThresholds(manager, 3, [
      {
        nutrient: "calories",
        minAmount: 1800,
        maxAmount: 2200,
        unit: "kcal",
        isActive: true,
        origin: "system",
      },
    ]);

    expect(thresholdRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 3, nutrient: "calories" }),
    );
    expect(thresholdRepo.save).toHaveBeenCalled();
  });

  it("deactivates nutrients missing from the replacement set", async () => {
    const existing = [
      {
        id: 2,
        userId: 5,
        nutrient: "fiber",
        minAmount: 20,
        maxAmount: null,
        unit: "g",
        isActive: true,
        origin: "system",
      } as UserNutritionalThresholdEntity,
    ];
    const { manager, thresholdRepo } = mockManager(existing);

    await service.replaceUserThresholds(manager, 5, [
      {
        nutrient: "protein",
        minAmount: 100,
        maxAmount: 120,
        unit: "g",
        isActive: true,
        origin: "system",
      },
    ]);

    expect(thresholdRepo.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ nutrient: "fiber", isActive: false }),
        expect.objectContaining({ nutrient: "protein", isActive: true }),
      ]),
    );
  });
});
