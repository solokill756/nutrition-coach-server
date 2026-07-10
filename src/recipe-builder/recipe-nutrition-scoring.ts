import type { RecipeGenerationContext } from "../nutrition/user-context.service";
import type { RecipeMealSlot } from "./dto/recipe.dto";

export type MealNutritionTarget = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export const MEAL_SPLITS: Record<RecipeMealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.35,
  snack: 0.1,
  dinner: 0.3,
};

export function thresholdMidpoint(
  ctx: RecipeGenerationContext,
  nutrient: string,
): number | null {
  const row = ctx.thresholds.find((item) => item.nutrient.toLowerCase() === nutrient);
  if (!row) return null;
  const min = row.minAmount;
  const max = row.maxAmount;
  if (min != null && max != null) return (Number(min) + Number(max)) / 2;
  if (max != null) return Number(max);
  if (min != null) return Number(min);
  return null;
}

export function slotTarget(
  ctx: RecipeGenerationContext,
  mealSlot: RecipeMealSlot,
): MealNutritionTarget {
  const dailyCalories =
    ctx.dailyTargetCalories ??
    thresholdMidpoint(ctx, "calories") ??
    Math.max(1600, Math.round((ctx.remaining.calories ?? 2000) + ctx.todayIntake.totalCalories));
  const split = MEAL_SPLITS[mealSlot];
  return {
    calories: Math.round(dailyCalories * split),
    protein: Math.round((thresholdMidpoint(ctx, "protein") ?? (dailyCalories * 0.25) / 4) * split),
    carbs: Math.round((thresholdMidpoint(ctx, "carbs") ?? (dailyCalories * 0.5) / 4) * split),
    fat: Math.round((thresholdMidpoint(ctx, "fat") ?? (dailyCalories * 0.25) / 9) * split),
  };
}

export function distanceScore(actual: number, target: number): number {
  if (target <= 0) return 1;
  const distance = Math.abs(actual - target) / target;
  return Math.max(0, Math.min(1, 1 - distance));
}

export function scoreNutrition(
  actual: { calories?: number; protein?: number; carbs?: number; fat?: number },
  target: MealNutritionTarget,
): number {
  const parts = [
    distanceScore(Number(actual.calories ?? 0), target.calories),
    distanceScore(Number(actual.protein ?? 0), target.protein),
    distanceScore(Number(actual.carbs ?? 0), target.carbs),
    distanceScore(Number(actual.fat ?? 0), target.fat),
  ];
  return Math.round((parts.reduce((sum, item) => sum + item, 0) / parts.length) * 100) / 100;
}

export function scoreWarnings(
  actual: { calories?: number; protein?: number; carbs?: number; fat?: number },
  target: MealNutritionTarget,
): string[] {
  const warnings: string[] = [];
  const check = (label: string, value: number | undefined, targetValue: number) => {
    if (targetValue <= 0 || value == null) return;
    const diff = Math.abs(value - targetValue) / targetValue;
    if (diff > 0.15) {
      warnings.push(`${label} differs from the slot target by about ${Math.round(diff * 100)}%.`);
    }
  };
  check("Calories", actual.calories, target.calories);
  check("Protein", actual.protein, target.protein);
  check("Carbs", actual.carbs, target.carbs);
  check("Fat", actual.fat, target.fat);
  return warnings;
}
