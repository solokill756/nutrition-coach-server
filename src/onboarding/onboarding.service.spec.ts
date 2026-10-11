import { NotFoundException } from "@nestjs/common";
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
  return { service, nutritionCalculator, userRepo, goalRepo, healthRepo, thresholdRepo, thresholdBuilder };
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
});
