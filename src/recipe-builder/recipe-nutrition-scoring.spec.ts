import {
  MEAL_SPLITS,
  distanceScore,
  scoreNutrition,
  scoreWarnings,
  slotTarget,
  thresholdMidpoint,
} from "./recipe-nutrition-scoring";
import type { RecipeGenerationContext } from "../nutrition/user-context.service";

function makeCtx(partial: Partial<RecipeGenerationContext> = {}): RecipeGenerationContext {
  return {
    userId: 1,
    dateKey: "2026-06-23",
    mealSlot: "lunch",
    recentLogHistoryDays: 7,
    profile: {} as any,
    goalsDetailed: [],
    healthDetailed: [],
    thresholds: [],
    conditionRelatedThresholds: [],
    recentHistory: [],
    recentRecipeLogs: [],
    todayIntake: {
      totalCalories: 0,
      totalProtein: 0,
      totalCarbs: 0,
      totalFat: 0,
      totalSodium: 0,
      totalSugar: 0,
      totalSaturatedFat: 0,
      totalCholesterol: 0,
      totalPotassium: 0,
    },
    dailyTargetCalories: 2000,
    remaining: {
      calories: 2000,
      sodiumMg: null,
      carbsG: null,
      proteinG: null,
      fatG: null,
      sugarG: null,
      saturatedFatG: null,
      cholesterolMg: null,
      potassiumMgMinRemaining: null,
    },
    ...partial,
  } as RecipeGenerationContext;
}

describe("recipe-nutrition-scoring", () => {
  it("distanceScore clamps to [0,1] and returns 1 for non-positive target", () => {
    expect(distanceScore(100, 100)).toBe(1);
    expect(distanceScore(50, 0)).toBe(1);
    expect(distanceScore(200, 100)).toBe(0);
    expect(distanceScore(150, 100)).toBeCloseTo(0.5, 5);
  });

  it("scoreNutrition averages the four metric distances", () => {
    const score = scoreNutrition(
      { calories: 700, protein: 44, carbs: 88, fat: 19 },
      { calories: 700, protein: 44, carbs: 88, fat: 19 },
    );
    expect(score).toBe(1);
  });

  it("slotTarget splits the daily target by MEAL_SPLITS", () => {
    const target = slotTarget(makeCtx({ dailyTargetCalories: 2000 }), "lunch");
    expect(target.calories).toBe(Math.round(2000 * MEAL_SPLITS.lunch));
  });

  it("scoreWarnings only warns when deviation exceeds 15%", () => {
    const target = { calories: 700, protein: 44, carbs: 88, fat: 19 };
    expect(scoreWarnings({ calories: 700, protein: 44, carbs: 88, fat: 19 }, target)).toEqual([]);
    const warnings = scoreWarnings({ calories: 900, protein: 44, carbs: 88, fat: 19 }, target);
    expect(warnings.some((w) => w.startsWith("Calories"))).toBe(true);
  });

  it("thresholdMidpoint returns midpoint, or available bound", () => {
    const ctx = makeCtx({
      thresholds: [
        { nutrient: "protein", minAmount: 100, maxAmount: 200 } as any,
        { nutrient: "carbs", minAmount: null, maxAmount: 150 } as any,
      ],
    });
    expect(thresholdMidpoint(ctx, "protein")).toBe(150);
    expect(thresholdMidpoint(ctx, "carbs")).toBe(150);
    expect(thresholdMidpoint(ctx, "fat")).toBeNull();
  });
});
