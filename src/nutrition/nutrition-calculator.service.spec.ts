import { NutritionCalculatorService } from "./nutrition-calculator.service";
import { UserNutritionalThresholdEntity } from "./entities/user-nutritional-threshold.entity";

describe("NutritionCalculatorService", () => {
  let service: NutritionCalculatorService;

  beforeEach(() => {
    service = new NutritionCalculatorService();
  });

  it("maps unknown goal slugs including legacy custom to maintenance", () => {
    expect(service.normalizeGoalType("custom")).toBe("maintenance");
    expect(service.normalizeGoalType("not_a_real_goal")).toBe("maintenance");
  });

  it("computes preset goal calories and macros", () => {
    const bmr = service.calculateBmr({
      gender: "female",
      age: 30,
      heightCm: 165,
      currentWeightKg: 60,
    });
    const tdee = service.calculateTdee(bmr, "moderate");
    const plan = service.computeNutritionPlan({
      gender: "female",
      age: 30,
      heightCm: 165,
      currentWeightKg: 60,
      activityLevel: "moderate",
      goalType: "weight_loss",
    });

    expect(plan.targetCalories).toBe(Math.max(1200, tdee - 500));
    expect(plan.proteinG).toBeGreaterThan(0);
    expect(plan.carbsG).toBeGreaterThan(0);
    expect(plan.fatG).toBeGreaterThan(0);
  });

  it("round-trips goal macro thresholds into nutrition targets", () => {
    const macros = service.macroBreakdownForGoal({
      gender: "female",
      age: 30,
      heightCm: 165,
      currentWeightKg: 60,
      activityLevel: "moderate",
      goalType: "maintenance",
      targetCalories: 2000,
    });
    const thresholds = service.buildDefaultThresholds(
      1,
      2000,
      macros,
    ) as UserNutritionalThresholdEntity[];

    const fromThresholds = service.macroBreakdownFromThresholds(
      2000,
      thresholds,
    );

    expect(fromThresholds?.proteinG).toBeGreaterThan(0);
    expect(fromThresholds?.carbsG).toBeGreaterThan(0);
    expect(fromThresholds?.fatG).toBeGreaterThan(0);
    expect(thresholds.find((t) => t.nutrient === "sugars")).toMatchObject({
      maxAmount: 50,
      unit: "g",
    });
  });

  it("does not apply disease-specific rules in base threshold calculation", () => {
    const macros = service.macroBreakdownForGoal({
      gender: "female",
      age: 30,
      heightCm: 165,
      currentWeightKg: 60,
      activityLevel: "moderate",
      goalType: "maintenance",
      targetCalories: 2000,
    });
    const thresholds = service.buildDefaultThresholds(
      1,
      2000,
      macros,
    ) as UserNutritionalThresholdEntity[];

    expect(thresholds.find((t) => t.nutrient === "sugars")).toMatchObject({
      maxAmount: 50,
      unit: "g",
      origin: "system",
    });
  });
});
