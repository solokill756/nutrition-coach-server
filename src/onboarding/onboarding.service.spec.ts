import { NotFoundException } from "@nestjs/common";
import { DashboardAiService } from "../dashboard/dashboard-ai.service";
import { sampleRecipeContext } from "../nutrition/__fixtures__/llm-context.fixture";
import { buildConditionRelatedThresholds } from "../nutrition/condition-related-thresholds";
import { ConditionNutrientRuleApplierService } from "../nutrition/condition-nutrient-rule-applier.service";
import { DEFAULT_CONDITION_NUTRIENT_RULES } from "../nutrition/condition-nutrient-rule-seed";
import { ConditionNutrientUnitService } from "../nutrition/condition-nutrient-unit.service";
import { NutritionCalculatorService } from "../nutrition/nutrition-calculator.service";
import { UserThresholdBuilderService } from "../nutrition/user-threshold-builder.service";
import { OnboardingService } from "./onboarding.service";

function createService() {
  const dataSource: any = {
    transaction: jest.fn(async (fn: any) => fn({
      update: jest.fn(),
      save: jest.fn(),
      create: jest.fn((_e: any, x: any) => x),
      getRepository: jest.fn(() => ({ create: jest.fn((x: any) => x) })),
    })),
  };
  const nutritionCalculator: any = {
    normalizeGoalType: jest.fn((g) => g),
    computeNutritionPlan: jest.fn(() => ({
      bmr: 1500, tdee: 2200, targetCalories: 1800,
      proteinG: 100, carbsG: 200, fatG: 60,
      proteinPercent: 25, carbsPercent: 45, fatPercent: 30,
    })),
    macroBreakdownForGoal: jest.fn(() => ({
      proteinG: 110, carbsG: 210, fatG: 70,
      proteinPercent: 25, carbsPercent: 45, fatPercent: 30,
    })),
    macroBreakdownFromThresholds: jest.fn(() => ({ carbsPercent: 50, proteinPercent: 20, fatPercent: 30 })),
    buildDefaultThresholds: jest.fn(() => []),
  };
  const userRepo: any = { findOne: jest.fn(), save: jest.fn() };
  const goalRepo: any = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
  const healthRepo: any = { find: jest.fn().mockResolvedValue([]) };
  const thresholdRepo: any = { find: jest.fn().mockResolvedValue([]) };

  const thresholdBuilder: any = {
    build: jest.fn().mockResolvedValue([]),
  };

  const thresholdPersistence: any = { replaceUserThresholds: jest.fn() };

  const service = new OnboardingService(
    dataSource, nutritionCalculator, thresholdBuilder, thresholdPersistence, userRepo, goalRepo, healthRepo, thresholdRepo,
  );
  return { service, nutritionCalculator, userRepo, goalRepo, healthRepo, thresholdRepo, thresholdBuilder, thresholdPersistence };
}

describe("OnboardingService", () => {
  it("previewNutrition returns plan", () => {
    const { service } = createService();
    const out = service.previewNutrition(1, {
      goalType: "weight_loss",
      gender: "female",
      age: 25,
      heightCm: 160,
      currentWeightKg: 60,
      activityLevel: "moderate",
      conditionTypes: [],
    } as any);
    expect(out.tdee).toBe(2200);
  });

  it("getSnapshot throws when user missing", async () => {
    const { service, userRepo } = createService();
    userRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.getSnapshot(1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("updateBasicInfo saves user and returns step response", async () => {
    const { service, userRepo, goalRepo, healthRepo } = createService();
    userRepo.findOne.mockResolvedValue({
      id: 1, delFlag: false, sex: null, age: null, height: null, weight: null, goalWeight: null, updatedAt: new Date(), isProfileComplete: false,
    });
    goalRepo.findOne.mockResolvedValue({ goalType: "weight_loss", targetCalories: 1800 });
    healthRepo.find.mockResolvedValue([]);
    const out = await service.updateBasicInfo(1, {
      gender: "female", age: 22, heightCm: 160, currentWeightKg: 55, displayName: "A",
    } as any);
    expect(out.saved).toBe(true);
  });

  it("passes seeded diabetes thresholds to persistence and the Dashboard prompt", async () => {
    const { service, nutritionCalculator, userRepo, goalRepo, healthRepo, thresholdBuilder, thresholdPersistence } = createService();
    const rules = DEFAULT_CONDITION_NUTRIENT_RULES
      .filter((rule) => rule.conditionKey === "diabetes")
      .map((rule, i) => ({ ...rule, id: i + 1 }));
    const units = new ConditionNutrientUnitService();
    const builder = new UserThresholdBuilderService(
      new NutritionCalculatorService(),
      new ConditionNutrientRuleApplierService(units),
      { find: jest.fn().mockResolvedValue(rules) } as never,
    );
    thresholdBuilder.build.mockImplementation(builder.build.bind(builder));
    nutritionCalculator.computeNutritionPlan.mockReturnValue({
      bmr: 1800, tdee: 3000, targetCalories: 3000,
      proteinG: 150, carbsG: 375, fatG: 100,
      proteinPercent: 20, carbsPercent: 50, fatPercent: 30,
    });
    userRepo.findOne.mockResolvedValue({
      id: 1, delFlag: false, isProfileComplete: false, displayName: "Test user",
      sex: "female", age: 35, height: 165, weight: 70, fitnessLevel: "moderate",
    });
    goalRepo.findOne.mockResolvedValue({ goalType: "maintain_weight" });
    healthRepo.find.mockResolvedValue([{ conditionName: "diabetes" }]);

    await service.complete(1, {});

    const [, userId, thresholds] = thresholdPersistence.replaceUserThresholds.mock.calls[0];
    expect(userId).toBe(1);
    expect(thresholds).toEqual(expect.arrayContaining([
      expect.objectContaining({ nutrient: "fiber", minAmount: 42, unit: "g", origin: "admin_rule", sourceConditionKey: "diabetes" }),
      expect.objectContaining({ nutrient: "sodium", maxAmount: 2300, unit: "mg", origin: "admin_rule", sourceConditionKey: "diabetes" }),
      expect.objectContaining({ nutrient: "sugars", origin: "system" }),
    ]));

    const conditionRelatedThresholds = buildConditionRelatedThresholds(
      ["diabetes"], thresholds, rules, (nutrient) => units.normalizeNutrient(nutrient),
    );
    const chat = jest.fn().mockResolvedValue('{"title":"Lunch","message":"Plan lunch."}');
    const retrieve = jest.fn().mockResolvedValue({ text: "None.", used: [] });
    const dashboard = new DashboardAiService(
      { chat } as never,
      { retrieve } as never,
    );
    await dashboard.buildAiSuggestion({
      userContext: sampleRecipeContext({
        thresholds,
        conditionRelatedThresholds,
        healthDetailed: [{ conditionName: "diabetes" }],
        dailyTargetCalories: 3000,
      }),
      calories: { target: 3000, consumed: 2100, burned: 0, net: 2100, remaining: 900, status: "on_track" },
      macros: { protein: { current: 40, target: 90 }, carbs: { current: 100, target: 200 }, fat: { current: 30, target: 60 } },
      exercise: { caloriesBurned: 0, minutes: 0, workoutCount: 0 },
      water: { currentMl: 400, targetMl: 2200 },
      remaining: 900,
      alerts: [],
    });
    expect(conditionRelatedThresholds).toHaveLength(2);
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "dashboard_suggestion", conditionRelatedThresholds }),
      { skipCrossEncoder: true },
    );
    expect(chat.mock.calls[0][0][1].content).toContain('"healthConditions":["diabetes"]');
    expect(chat.mock.calls[0][0][1].content).toContain("fiber min 42 g");
    expect(chat.mock.calls[0][0][1].content).toContain("sodium max 2300 mg");
  });
});
