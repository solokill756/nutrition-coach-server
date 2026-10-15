import { UserContextService } from "./user-context.service";

describe("UserContextService", () => {
  function setup() {
    const mkRepo = () => ({ findOne: jest.fn(), find: jest.fn(), create: jest.fn((x: any) => x), save: jest.fn(async (x: any) => x) });
    const goalRepo: any = mkRepo();
    goalRepo.find.mockResolvedValue([]);
    const healthRepo: any = mkRepo();
    healthRepo.find.mockResolvedValue([]);
    const thresholdRepo: any = mkRepo();
    thresholdRepo.find.mockResolvedValue([]);
    const summaryRepo: any = mkRepo();
    summaryRepo.findOne.mockResolvedValue(null);
    const logRepo: any = mkRepo();
    logRepo.find.mockResolvedValue([]);
    const userRepo: any = mkRepo();
    const foodRepo: any = mkRepo();
    const recipeRepo: any = mkRepo();
    const ruleRepo: any = mkRepo();
    ruleRepo.find.mockResolvedValue([]);
    const mockApplier: any = { applyRules: jest.fn(() => ({ thresholds: [], changedNutrients: [], warnings: [], rebalance: { status: "not_requested", adjustedNutrients: [] } })) };
    const mockUnits: any = { normalizeNutrient: (x: string) => x.trim().replace(/[_\s-]/g, "").toLowerCase() };
    const mockConfig: any = { get: jest.fn() };
    const service = new UserContextService(goalRepo, healthRepo, thresholdRepo, summaryRepo, logRepo, userRepo, foodRepo, recipeRepo, ruleRepo, mockApplier, mockUnits, mockConfig);
    return { service, goalRepo, healthRepo, thresholdRepo, summaryRepo, logRepo, userRepo, foodRepo, recipeRepo, ruleRepo, mockApplier };
  }

  it("assembleRecipeGenerationContext validates dateKey", async () => {
    const { service } = setup();
    await expect(service.assembleRecipeGenerationContext(1, "bad", "breakfast")).rejects.toThrow("Invalid dateKey");
  });

  it("assembleRecipeGenerationContext returns remaining budgets", async () => {
    const { service, userRepo, goalRepo, summaryRepo, healthRepo, thresholdRepo, ruleRepo } = setup();
    userRepo.findOne.mockResolvedValueOnce({ id: 1, age: 20, sex: "male", weight: 70, goalWeight: 68, height: 170, dietType: null, allergies: [], fitnessLevel: "active" });
    goalRepo.find.mockResolvedValueOnce([{ id: 1, goalType: "weight_loss", targetCalories: 2000, startDate: new Date(), endDate: null }]);
    healthRepo.find.mockResolvedValueOnce([{ conditionName: "hypertension", severity: "mild" }]);
    thresholdRepo.find.mockResolvedValueOnce([
      { nutrient: "protein", maxAmount: 120, minAmount: null, unit: "g" },
      { nutrient: "sodium", maxAmount: 1500, minAmount: 500, unit: "mg" },
      { nutrient: "sugars", maxAmount: 50, minAmount: null, unit: "g" },
    ]);
    ruleRepo.find.mockResolvedValue([
      { conditionKey: "hypertension", nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg", isActive: true },
    ]);
    summaryRepo.findOne.mockResolvedValueOnce({ totalCalories: 800, totalProtein: 30, totalCarbs: 100, totalFat: 20, totalSodium: 500, totalSugar: 10, totalSaturatedFat: 5, totalCholesterol: 100, totalPotassium: 500 });

    const out = await service.assembleRecipeGenerationContext(1, "2026-05-31", "lunch");
    expect(out.dailyTargetCalories).toBe(2000);
    expect(out.remaining.calories).toBe(1200);
    expect(out.remaining.sugarG).toBe(40);
    expect(out.healthDetailed).toHaveLength(1);
    expect(out.conditionRelatedThresholds).toEqual([
      { nutrient: "sodium", maxAmount: 1500, minAmount: 500, unit: "mg" },
    ]);
  });

  it("assembleRecipeGenerationContext carries the user's meal split", async () => {
    const { service, userRepo } = setup();
    userRepo.findOne.mockResolvedValueOnce({
      id: 1, age: 20, sex: "male", weight: 70, goalWeight: 68, height: 170, dietType: null, allergies: [], fitnessLevel: "active",
      mealSplits: { breakfast: 20, lunch: 40, dinner: 35, snack: 5 },
    });
    const out = await service.assembleRecipeGenerationContext(1, "2026-05-31", "lunch");
    expect(out.mealSplits).toEqual({ breakfast: 0.2, lunch: 0.4, dinner: 0.35, snack: 0.05 });
  });

  it("assembleRecipeGenerationContext maps recipe logs from the single 3-day log query without loading food history", async () => {
    const { service, userRepo, goalRepo, healthRepo, thresholdRepo, logRepo, foodRepo, recipeRepo } = setup();
    const loggedAt = new Date("2026-05-30T00:00:00.000Z");
    userRepo.findOne.mockResolvedValueOnce({ id: 1, age: 20, sex: "male", weight: 70, goalWeight: 68, height: 170, dietType: null, allergies: [], fitnessLevel: "active" });
    goalRepo.find.mockResolvedValueOnce([{ id: 1, goalType: "maintenance", targetCalories: 2000, startDate: new Date(), endDate: null }]);
    healthRepo.find.mockResolvedValueOnce([]);
    thresholdRepo.find.mockResolvedValueOnce([]);
    logRepo.find.mockResolvedValueOnce([
      { meal: 2, calories: "120", loggedAt, foodId: 9, recipeId: 7, foodName: "Rice log" },
    ]);
    foodRepo.find.mockResolvedValueOnce([{ id: 9, foodName: "Rice" }]);
    recipeRepo.find.mockResolvedValueOnce([{ id: 7, name: "Rice bowl" }]);

    const out = await service.assembleRecipeGenerationContext(1, "2026-05-31", "lunch");

    // Food-level history is intentionally no longer loaded; only recipe logs are surfaced.
    expect(out.recentHistory).toEqual([]);
    expect(out.recentRecipeLogs).toEqual([{ recipeName: "Rice bowl", recipeId: 7, loggedAt, mealType: "lunch" }]);
    expect(logRepo.find).toHaveBeenCalledTimes(1);
    expect(foodRepo.find).not.toHaveBeenCalled();
    expect(recipeRepo.find).toHaveBeenCalledTimes(1);
  });

  it("assembleContext maps summary without loading recent log food history", async () => {
    const { service, userRepo, goalRepo, healthRepo, thresholdRepo, logRepo, summaryRepo, foodRepo } = setup();
    userRepo.findOne.mockResolvedValueOnce({ id: 1, displayName: "U", age: 20, sex: "male", weight: 70, goalWeight: 68, height: 170, dietType: null, allergies: [], fitnessLevel: "active" });
    goalRepo.find.mockResolvedValueOnce([{ goalType: "maintenance", targetCalories: 1800 }]);
    healthRepo.find.mockResolvedValueOnce([{ conditionName: "diabetes" }]);
    thresholdRepo.find.mockResolvedValueOnce([{ nutrient: "sodium", maxAmount: 2000, minAmount: null, unit: "mg" }]);
    summaryRepo.findOne.mockResolvedValueOnce({ totalCalories: 1000, totalSodium: 500, totalCarbs: 120, totalProtein: 40, totalFat: 30, totalSugar: 20, totalSaturatedFat: 8, totalCholesterol: 120, totalPotassium: 600 });

    const out = await service.assembleContext(1);
    expect(out.recentHistory).toEqual([]);
    expect(out.todaySummary?.totalCalories).toBe(1000);
    expect(logRepo.find).not.toHaveBeenCalled();
    expect(foodRepo.find).not.toHaveBeenCalled();
  });

  it("does not seed or invent a sugars threshold when it is missing (remaining sugar is null)", async () => {
    const { service, userRepo, goalRepo, summaryRepo, healthRepo, thresholdRepo, ruleRepo, mockApplier } = setup();
    userRepo.findOne.mockResolvedValueOnce({ id: 1, age: 20, sex: "male", weight: 70, goalWeight: 68, height: 170, dietType: null, allergies: [], fitnessLevel: "active" });
    goalRepo.find.mockResolvedValueOnce([{ id: 1, goalType: "maintenance", targetCalories: 2000, startDate: new Date(), endDate: null }]);
    healthRepo.find.mockResolvedValueOnce([{ conditionName: "diabetes", severity: "mild" }]);
    thresholdRepo.find.mockResolvedValueOnce([]);
    ruleRepo.find.mockResolvedValueOnce([
      { id: 2, conditionKey: "diabetes", nutrient: "sugars", minAmount: null, maxAmount: 25, unit: "g", rebalanceMode: "strict", isActive: true },
    ]);
    mockApplier.applyRules.mockReturnValueOnce({
      thresholds: [{ nutrient: "sugars", minAmount: null, maxAmount: 25, unit: "g", origin: "admin_rule", sourceConditionKey: "diabetes", sourceRuleId: 2 }],
      changedNutrients: ["sugars"],
      warnings: [],
      rebalance: { status: "not_requested", adjustedNutrients: [] },
    });
    summaryRepo.findOne.mockResolvedValueOnce({ totalCalories: 800, totalProtein: 30, totalCarbs: 100, totalFat: 20, totalSodium: 500, totalSugar: 10, totalSaturatedFat: 5, totalCholesterol: 100, totalPotassium: 500 });

    const out = await service.assembleRecipeGenerationContext(1, "2026-05-31", "lunch");

    // Thresholds are persisted at onboarding; reading context never writes them or applies rules.
    expect(out.remaining.sugarG).toBeNull();
    expect(thresholdRepo.save).not.toHaveBeenCalled();
    expect(mockApplier.applyRules).not.toHaveBeenCalled();
  });

  it("assembleContext does not query rules when user has no conditions", async () => {
    const { service, ruleRepo, userRepo } = setup();
    userRepo.findOne.mockResolvedValue({ id: 1, displayName: "U", age: 30, sex: "male", weight: 70, goalWeight: 68, height: 175, dietType: null, allergies: [], fitnessLevel: "active" });
    await service.assembleContext(1);
    expect(ruleRepo.find).not.toHaveBeenCalled();
  });

  it("does not insert a threshold on read when a rule exists but the threshold is missing", async () => {
    const { service, ruleRepo, thresholdRepo, healthRepo, goalRepo, userRepo, mockApplier } = setup();
    userRepo.findOne.mockResolvedValue({ id: 1, displayName: "U", age: 30, sex: "male", weight: 70, goalWeight: 68, height: 175, dietType: null, allergies: [], fitnessLevel: "active" });
    healthRepo.find.mockResolvedValue([{ conditionName: "hypertension", isActive: true }]);
    goalRepo.find.mockResolvedValue([{ goalType: "maintenance", targetCalories: 2000, isActive: true }]);
    thresholdRepo.find.mockResolvedValue([]);
    ruleRepo.find.mockResolvedValue([
      { id: 1, conditionKey: "hypertension", nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg", rebalanceMode: "strict", isActive: true },
    ]);
    mockApplier.applyRules.mockReturnValue({
      thresholds: [{ nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg", origin: "admin_rule", sourceConditionKey: "hypertension", sourceRuleId: 1 }],
      changedNutrients: ["sodium"],
      warnings: [],
      rebalance: { status: "not_requested", adjustedNutrients: [] },
    });
    await service.assembleContext(1);
    expect(thresholdRepo.save).not.toHaveBeenCalled();
    expect(mockApplier.applyRules).not.toHaveBeenCalled();
  });

  it("assembleContext leaves existing thresholds untouched", async () => {
    const { service, ruleRepo, thresholdRepo, healthRepo, goalRepo, userRepo } = setup();
    userRepo.findOne.mockResolvedValue({ id: 1, displayName: "U", age: 30, sex: "male", weight: 70, goalWeight: 68, height: 175, dietType: null, allergies: [], fitnessLevel: "active" });
    healthRepo.find.mockResolvedValue([{ conditionName: "hypertension", isActive: true }]);
    goalRepo.find.mockResolvedValue([{ goalType: "maintenance", targetCalories: 2000, isActive: true }]);
    thresholdRepo.find.mockResolvedValue([
      { nutrient: "sodium", minAmount: 500, maxAmount: 2000, unit: "mg", isActive: true },
    ]);
    ruleRepo.find.mockResolvedValue([
      { id: 1, conditionKey: "hypertension", nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg", rebalanceMode: "strict", isActive: true },
    ]);
    await service.assembleContext(1);
    expect(thresholdRepo.save).not.toHaveBeenCalled();
  });
});
