import { BadRequestException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { ConditionNutrientRuleApplierService } from "../nutrition/condition-nutrient-rule-applier.service";
import { DEFAULT_CONDITION_NUTRIENT_RULES } from "../nutrition/condition-nutrient-rule-seed";
import { ConditionNutrientUnitService } from "../nutrition/condition-nutrient-unit.service";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { UserHealthConditionEntity } from "../nutrition/entities/user-health-condition.entity";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";
import { NutritionCalculatorService } from "../nutrition/nutrition-calculator.service";
import { UserThresholdBuilderService } from "../nutrition/user-threshold-builder.service";
import { UserThresholdPersistenceService } from "../nutrition/user-threshold-persistence.service";
import { UserHealthProfileService } from "./user-health-profile.service";

function setup() {
  const user = {
    id: 1, isProfileComplete: true, age: 31, sex: "female", height: 165, weight: 65,
    fitnessLevel: "moderate", allergies: ["eggs"], mealSplits: null,
  };
  const goal = { id: 2, goalType: "maintenance", targetCalories: 1900 };
  let conditions: Partial<UserHealthConditionEntity>[] = [
    { id: 3, conditionName: "hypertension", severity: "mild", isActive: true },
  ];
  let thresholds: Partial<UserNutritionalThresholdEntity>[] = [
    {
      nutrient: "fiber", minAmount: 25, maxAmount: null, unit: "g",
      isActive: true, origin: "user_custom", isCustomized: true,
    },
  ];
  const ruleRepo = {
    find: jest.fn(async ({ where }) => DEFAULT_CONDITION_NUTRIENT_RULES
      .filter((r) => where.conditionKey.value.includes(r.conditionKey))
      .map((r, index) => ({ ...r, id: index + 1 }))),
  };
  const thresholdRepo = {
    find: jest.fn(async () => thresholds),
    create: jest.fn((row) => ({ ...row })),
    save: jest.fn(async (rows) => { thresholds = rows; }),
  };
  const manager = {
    getRepository: jest.fn((entity) => entity === UserNutritionalThresholdEntity ? thresholdRepo : ruleRepo),
    findOne: jest.fn(async (entity: unknown) =>
      entity === AppUserEntity ? user : entity === UserGoalEntity ? goal : null),
    find: jest.fn(async (entity: unknown) =>
      entity === UserHealthConditionEntity ? conditions.filter((c) => c.isActive) : thresholds),
    create: jest.fn((_entity: unknown, values: object) => ({ ...values })),
    save: jest.fn(async (entity: unknown, values: Partial<UserHealthConditionEntity>[]) => {
      if (entity === UserHealthConditionEntity) {
        conditions = [...conditions.filter((c) => !values.includes(c)), ...values];
      }
    }),
    update: jest.fn(),
  } as unknown as EntityManager;
  const tx = jest.fn(async (callback) => callback(manager));
  const units = new ConditionNutrientUnitService();
  const calculator = new NutritionCalculatorService();
  const builder = new UserThresholdBuilderService(
    calculator,
    new ConditionNutrientRuleApplierService(units),
    ruleRepo as never,
  );
  const persistence = new UserThresholdPersistenceService(units);
  const service = new UserHealthProfileService({ transaction: tx } as unknown as DataSource, calculator, builder, persistence);
  return { service, user, goal, tx, manager, calculator, thresholds: () => thresholds, conditions: () => conditions };
}

describe("UserHealthProfileService", () => {
  it("adds and removes diabetes while keeping the remaining disease and restoring a custom target", async () => {
    const { service, user, thresholds, conditions } = setup();
    await service.update(1, { conditionTypes: ["hypertension", "diabetes"] });

    expect(thresholds()).toEqual(expect.arrayContaining([
      expect.objectContaining({ nutrient: "fiber", minAmount: 26.6, origin: "admin_rule", previousCustomMinAmount: 25 }),
      expect.objectContaining({ nutrient: "sodium", maxAmount: 1500, origin: "admin_rule" }),
    ]));
    expect(conditions().find((c) => c.conditionName === "hypertension")?.severity).toBe("mild");

    await service.update(1, { conditionTypes: ["hypertension"] });

    expect(thresholds()).toEqual(expect.arrayContaining([
      expect.objectContaining({ nutrient: "fiber", minAmount: 25, origin: "user_custom", sourceConditionKey: null, previousCustomUnit: null }),
      expect.objectContaining({ nutrient: "sodium", maxAmount: 1500, origin: "admin_rule" }),
    ]));
    expect(user.allergies).toEqual(["eggs"]);
    expect(user.isProfileComplete).toBe(true);
  });

  it("rejects invalid meal percentages before any write", async () => {
    const { service, tx } = setup();
    await expect(service.update(1, { mealSplits: { breakfast: 10, lunch: 20, dinner: 30, snack: 0 } }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx).not.toHaveBeenCalled();
  });

  it("updates only the provided profile fields and supports resetting meal percentages", async () => {
    const { service, manager, conditions } = setup();
    const mealSplits = { breakfast: 25, lunch: 25, dinner: 50, snack: 0 };
    await service.update(1, { allergies: [], mealSplits });
    expect(manager.update).toHaveBeenCalledWith(AppUserEntity, 1, {
      allergies: [], mealSplits, updatedAt: expect.any(Date),
    });
    expect(conditions()).toHaveLength(1);
    await service.update(1, { mealSplits: null });
    expect(manager.update).toHaveBeenLastCalledWith(AppUserEntity, 1, {
      mealSplits: null, updatedAt: expect.any(Date),
    });
  });

  it("recomputes a calculated calorie goal when measurements change", async () => {
    const { service, goal, manager, calculator } = setup();
    const input = {
      age: 31, gender: "female", heightCm: 165, currentWeightKg: 65,
      activityLevel: "moderate", goalType: "maintenance",
    };
    goal.targetCalories = calculator.computeNutritionPlan(input).targetCalories;
    const expected = calculator.computeNutritionPlan({ ...input, age: 40, heightCm: 170 }).targetCalories;
    expect(expected).not.toBe(goal.targetCalories);

    await service.update(1, { age: 40, heightCm: 170 });

    expect(manager.update).toHaveBeenCalledWith(UserGoalEntity, goal.id, {
      targetCalories: expected, updatedAt: expect.any(Date),
    });
    expect(manager.update).toHaveBeenCalledWith(AppUserEntity, 1, {
      age: 40, height: 170, updatedAt: expect.any(Date),
    });
  });
});
