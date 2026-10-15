import {
  MEAL_SPLITS,
  distanceScore,
  mealShare,
  usesDefaultShare,
  scoreNutrition,
  scoreWarnings,
  slotCaloriesCap,
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
  it("scoreWarnings says which way a macro is off, with the numbers", () => {
    const target = { calories: 700, protein: 25, carbs: 88, fat: 19 };
    expect(
      scoreWarnings({ calories: 700, protein: 62, carbs: 66, fat: 19 }, target),
    ).toEqual([
      "Protein is 148% above this meal's target (62 g vs 25 g).",
      "Carbs is 25% below this meal's target (66 g vs 88 g).",
    ]);
    expect(scoreWarnings({ calories: 900, protein: 25, carbs: 88, fat: 19 }, target)).toEqual([
      "Calories is 29% above this meal's target (900 kcal vs 700 kcal).",
    ]);
  });

  it("slotCaloriesCap is the meal's share of the day, never more than what is left", () => {
    const eatenSoFar = (remaining: number | null) =>
      makeCtx({
        dailyTargetCalories: 2000,
        remaining: { ...makeCtx().remaining, calories: remaining },
      });
    // Dinner is 30% of 2000 = 600 kcal; 800 kcal left today must not shrink it to 240.
    expect(slotCaloriesCap(eatenSoFar(800), "dinner")).toBe(600);
    expect(slotCaloriesCap(eatenSoFar(300), "dinner")).toBe(300);
    expect(slotCaloriesCap(eatenSoFar(0), "dinner")).toBe(0);
    expect(slotCaloriesCap(eatenSoFar(null), "dinner")).toBeNull();
  });

  it("uses the user's meal split for a meal's targets", () => {
    const ctx = makeCtx({
      dailyTargetCalories: 2000,
      mealSplits: { breakfast: 0.2, lunch: 0.4, dinner: 0.35, snack: 0.05 },
    } as any);
    expect(slotTarget(ctx, "lunch").calories).toBe(800);
    expect(slotCaloriesCap(ctx, "lunch")).toBe(800);
  });

  it("falls back to the default share for a meal set to 0%", () => {
    const ctx = makeCtx({
      dailyTargetCalories: 2000,
      mealSplits: { breakfast: 0.3, lunch: 0.4, dinner: 0.3, snack: 0 },
    } as any);
    expect(mealShare(ctx, "snack")).toBe(0.1);
    expect(usesDefaultShare(ctx, "snack")).toBe(true);
    expect(usesDefaultShare(ctx, "lunch")).toBe(false);
    expect(slotTarget(ctx, "snack").calories).toBe(200);
  });
});
