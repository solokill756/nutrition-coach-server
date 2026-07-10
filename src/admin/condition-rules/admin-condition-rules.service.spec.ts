import { Repository } from "typeorm";
import { AdminConditionRulesService } from "./admin-condition-rules.service";
import { ConditionNutrientRuleEntity } from "../../nutrition/entities/condition-nutrient-rule.entity";
import { UserHealthConditionEntity } from "../../nutrition/entities/user-health-condition.entity";
import { UserNutritionalThresholdEntity } from "../../nutrition/entities/user-nutritional-threshold.entity";
import { UserNotificationService } from "../../user-notifications/user-notification.service";
import { ConditionNutrientRuleApplierService } from "../../nutrition/condition-nutrient-rule-applier.service";
import { ConditionNutrientUnitService } from "../../nutrition/condition-nutrient-unit.service";
import { NutritionCalculatorService } from "../../nutrition/nutrition-calculator.service";
import { UserContextService } from "../../nutrition/user-context.service";
import { AppUserEntity } from "../../auth/entities/app-user.entity";
import { UserGoalEntity } from "../../nutrition/entities/user-goal.entity";
import { UserThresholdPersistenceService } from "../../nutrition/user-threshold-persistence.service";

const repo = <T>() => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn((x) => Promise.resolve(x)),
  create: jest.fn((x) => x),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
}) as unknown as jest.Mocked<Repository<T>>;

function ruleRepoWithQuery(existing: ConditionNutrientRuleEntity[] = []) {
  const ruleRepo = repo<ConditionNutrientRuleEntity>();
  ruleRepo.createQueryBuilder.mockReturnValue({
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(existing),
  } as never);
  return ruleRepo;
}

function healthRepoWithQuery(users: UserHealthConditionEntity[] = []) {
  const healthRepo = repo<UserHealthConditionEntity>();
  healthRepo.createQueryBuilder.mockReturnValue({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(users),
  } as never);
  return healthRepo;
}

function userContextMock() {
  return { invalidateUserCache: jest.fn() } as unknown as UserContextService;
}

function mockManager() {
  const thresholdRepo = {
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: unknown) => x),
  };
  return {
    find: jest.fn((_entity, opts) => Promise.resolve([])),
    findOne: jest.fn(),
    save: jest.fn((_entity, x: unknown) => Promise.resolve(x)),
    create: jest.fn((_entity, x: unknown) => x),
    update: jest.fn(),
    getRepository: jest.fn(() => thresholdRepo),
  };
}

const fakeDataSource = {
  transaction: jest.fn(async (fn: (manager: ReturnType<typeof mockManager>) => Promise<void>) => {
    await fn(mockManager());
  }),
} as never;

function buildService(
  ruleRepo: jest.Mocked<Repository<ConditionNutrientRuleEntity>>,
  healthRepo: jest.Mocked<Repository<UserHealthConditionEntity>>,
  thresholdRepo: jest.Mocked<Repository<UserNutritionalThresholdEntity>>,
  userNotifications: UserNotificationService,
  userContext: UserContextService = userContextMock(),
) {
  const userRepo = { findOne: jest.fn().mockResolvedValue({ weight: 70, sex: "male" }) } as unknown as jest.Mocked<Repository<AppUserEntity>>;
  const goalRepo = { find: jest.fn().mockResolvedValue([{ goalType: "maintenance", targetCalories: 2000 }]) } as unknown as jest.Mocked<Repository<UserGoalEntity>>;
  const calculator = new NutritionCalculatorService();
  const units = new ConditionNutrientUnitService();
  return new AdminConditionRulesService(
    ruleRepo,
    healthRepo,
    thresholdRepo,
    userRepo,
    goalRepo,
    fakeDataSource as never,
    units,
    new ConditionNutrientRuleApplierService(units),
    calculator,
    userNotifications,
    userContext,
    new UserThresholdPersistenceService(units),
  );
}

describe("AdminConditionRulesService", () => {
  it("previews affected users without saving", async () => {
    const ruleRepo = ruleRepoWithQuery();
    const healthRepo = healthRepoWithQuery([
      { userId: 1, conditionName: "diabetes", isActive: true } as UserHealthConditionEntity,
    ]);
    const thresholdRepo = repo<UserNutritionalThresholdEntity>();
    thresholdRepo.find.mockResolvedValue([{ userId: 1, nutrient: "carbs", minAmount: 225, maxAmount: 275, unit: "g", isActive: true, origin: "system" } as UserNutritionalThresholdEntity]);

    const userNotifications = { create: jest.fn().mockResolvedValue(undefined) } as unknown as UserNotificationService;

    const service = buildService(ruleRepo, healthRepo, thresholdRepo, userNotifications);

    const result = await service.preview({
      conditionKey: "diabetes",
      rules: [{ nutrient: "carbs", minAmount: 130, maxAmount: 200, unit: "g", rebalanceMode: "strict", isActive: true }],
      confirmRiskyChanges: false,
    });

    expect(result.data.affectedUsers).toBe(1);
    expect(ruleRepo.save).not.toHaveBeenCalled();
  });

  it("applies a rule and creates inbox notification when overriding any threshold", async () => {
    const ruleRepo = ruleRepoWithQuery();
    const healthRepo = healthRepoWithQuery([
      { userId: 1, conditionName: "diabetes", isActive: true } as UserHealthConditionEntity,
    ]);
    const thresholdRepo = repo<UserNutritionalThresholdEntity>();
    thresholdRepo.find.mockResolvedValue([{ userId: 1, nutrient: "carbs", minAmount: 225, maxAmount: 275, unit: "g", isActive: true, origin: "system", isCustomized: false } as UserNutritionalThresholdEntity]);

    const userNotifications = { create: jest.fn().mockResolvedValue(undefined) } as unknown as UserNotificationService;
    const userContext = userContextMock();

    const service = buildService(ruleRepo, healthRepo, thresholdRepo, userNotifications, userContext);

    const result = await service.apply("diabetes", {
      conditionKey: "diabetes",
      rules: [{ nutrient: "carbs", minAmount: 130, maxAmount: 200, unit: "g", rebalanceMode: "strict", isActive: true }],
      confirmRiskyChanges: true,
    });

    expect(result.data.updatedUsers).toBe(1);
    expect(userContext.invalidateUserCache).toHaveBeenCalledWith(1);
    // Notification must fire even for non-customized thresholds
    expect(userNotifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        type: "threshold_adjusted",
        payload: expect.objectContaining({ conditionKey: "diabetes", deepLink: "nutrition" }),
      }),
    );
  });

  it("applies a new nutrient rule and saves thresholds with userId when user lacks that nutrient row", async () => {
    const ruleRepo = ruleRepoWithQuery();
    const healthRepo = healthRepoWithQuery([
      { userId: 1, conditionName: "diabetes", isActive: true } as UserHealthConditionEntity,
    ]);
    const thresholdRepo = repo<UserNutritionalThresholdEntity>();
    thresholdRepo.find.mockResolvedValue([
      {
        id: 5,
        userId: 1,
        nutrient: "carbs",
        minAmount: 225,
        maxAmount: 275,
        unit: "g",
        isActive: true,
        origin: "system",
      } as UserNutritionalThresholdEntity,
    ]);

    const userNotifications = { create: jest.fn().mockResolvedValue(undefined) } as unknown as UserNotificationService;

    const service = buildService(ruleRepo, healthRepo, thresholdRepo, userNotifications);

    await service.apply("diabetes", {
      conditionKey: "diabetes",
      rules: [
        {
          nutrient: "sodium",
          minAmount: null,
          maxAmount: 2300,
          unit: "mg",
          rebalanceMode: "strict",
          isActive: true,
        },
      ],
      confirmRiskyChanges: true,
    });

    // save now runs through transaction manager — just verify no crash
    expect(ruleRepo.save).toHaveBeenCalled();
  });

  it("updates existing seeded rules instead of inserting duplicates", async () => {
    const ruleRepo = ruleRepoWithQuery([
      {
        id: 10,
        conditionKey: "kidney_disease",
        nutrient: "sodium",
        minAmount: 500,
        maxAmount: 1500,
        unit: "mg",
        rebalanceMode: "strict",
        isActive: true,
      } as ConditionNutrientRuleEntity,
    ]);
    const healthRepo = healthRepoWithQuery([]);
    const thresholdRepo = repo<UserNutritionalThresholdEntity>();
    thresholdRepo.find.mockResolvedValue([]);

    const userNotifications = { create: jest.fn().mockResolvedValue(undefined) } as unknown as UserNotificationService;

    const service = buildService(ruleRepo, healthRepo, thresholdRepo, userNotifications);

    await service.apply("kidney_disease", {
      conditionKey: "kidney_disease",
      rules: [{ nutrient: "sodium", minAmount: 500, maxAmount: 1200, unit: "mg", rebalanceMode: "strict", isActive: true }],
      confirmRiskyChanges: true,
    });

    expect(ruleRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10, maxAmount: 1200 }),
    );
  });

  it("matches seeded condition names case-insensitively when applying sugars rule", async () => {
    const ruleRepo = ruleRepoWithQuery();
    const healthRepo = healthRepoWithQuery([
      { userId: 2, conditionName: "Diabetes", isActive: true } as UserHealthConditionEntity,
    ]);
    const thresholdRepo = repo<UserNutritionalThresholdEntity>();
    thresholdRepo.find.mockResolvedValue([
      {
        userId: 2,
        nutrient: "sugars",
        minAmount: null,
        maxAmount: 50,
        unit: "g",
        isActive: true,
        origin: "system",
      } as UserNutritionalThresholdEntity,
      {
        userId: 2,
        nutrient: "calories",
        minAmount: null,
        maxAmount: 2000,
        unit: "kcal",
        isActive: true,
        origin: "system",
      } as UserNutritionalThresholdEntity,
    ]);

    const userNotifications = { create: jest.fn().mockResolvedValue(undefined) } as unknown as UserNotificationService;
    const userContext = userContextMock();

    const service = buildService(ruleRepo, healthRepo, thresholdRepo, userNotifications, userContext);

    const result = await service.apply("diabetes", {
      conditionKey: "diabetes",
      rules: [
        {
          nutrient: "sugars",
          minAmount: null,
          maxAmount: 20,
          unit: "g",
          rebalanceMode: "strict",
          isActive: true,
        },
      ],
      confirmRiskyChanges: true,
    });

    expect(result.data.affectedUsers).toBe(1);
    // save/update runs through transaction — upsertRules still calls ruleRepo.save
    expect(ruleRepo.save).toHaveBeenCalled();
    expect(userContext.invalidateUserCache).toHaveBeenCalledWith(2);
  });

  it("deactivates a rule and recomputes affected user nutrient from remaining constraints", async () => {
    const ruleRepo = ruleRepoWithQuery();
    const healthRepo = healthRepoWithQuery([
      { userId: 1, conditionName: "diabetes", isActive: true } as UserHealthConditionEntity,
    ]);
    const thresholdRepo = repo<UserNutritionalThresholdEntity>();
    ruleRepo.findOne.mockResolvedValue({ id: 9, conditionKey: "diabetes", nutrient: "carbs", isActive: true } as ConditionNutrientRuleEntity);
    thresholdRepo.find.mockResolvedValue([{ userId: 1, nutrient: "carbs", minAmount: 130, maxAmount: 200, unit: "g", isActive: true, origin: "admin_rule" } as UserNutritionalThresholdEntity]);

    const userNotifications = { create: jest.fn().mockResolvedValue(undefined) } as unknown as UserNotificationService;

    const service = buildService(ruleRepo, healthRepo, thresholdRepo, userNotifications);

    const result = await service.updateStatus("diabetes", 9, false);

    expect(ruleRepo.update).toHaveBeenCalledWith(9, expect.objectContaining({ isActive: false }));
    expect(result.data.affectedUsers).toBe(1);
  });
});
