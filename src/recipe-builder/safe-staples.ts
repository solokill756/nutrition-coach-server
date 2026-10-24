import type { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import { findAllergens } from "../nutrition/allergen-match";
import type { ConditionNutrientUnitService } from "../nutrition/condition-nutrient-unit.service";
import type { UserNutrientThreshold } from "../nutrition/user-context.service";

export const CONDITION_MAX_SERVING_SHARE = 0.8;

export type RemovedStaple = { foodId: number; foodName: string; reason: string };
export type UncheckedStaple = { foodId: number; nutrient: string; reason: string };

const NUTRIENT_COLUMNS: Record<string, keyof FoodNutritionEntity> = {
  calories: "calories",
  protein: "protein",
  carbs: "carbs",
  fat: "fat",
  fiber: "fiber",
  sugars: "sugars",
  saturatedfat: "saturatedFat",
  sodium: "sodium",
  potassium: "potassium",
  calcium: "calcium",
  iron: "iron",
  magnesium: "magnesium",
  phosphorus: "phosphorus",
  zinc: "zinc",
  cholesterol: "cholesterol",
};

export function filterSafeStaples(
  staples: FoodNutritionEntity[],
  input: { allergies: string[]; conditionRelatedThresholds: UserNutrientThreshold[]; dailyTargetCalories: number | null },
  units: ConditionNutrientUnitService,
): { safe: FoodNutritionEntity[]; removed: RemovedStaple[]; unchecked: UncheckedStaple[] } {
  const safe: FoodNutritionEntity[] = [];
  const removed: RemovedStaple[] = [];
  const unchecked: UncheckedStaple[] = [];

  const limits: { nutrient: string; column: keyof FoodNutritionEntity | null; max: number | null; unit: string; error?: string }[] = [];
  for (const t of input.conditionRelatedThresholds) {
    if (t.maxAmount == null) continue;
    const nutrient = units.normalizeNutrient(t.nutrient);
    const column = NUTRIENT_COLUMNS[nutrient] ?? null;
    if (!column) {
      limits.push({ nutrient, column: null, max: null, unit: t.unit, error: "no nutrition column for this nutrient" });
      continue;
    }
    try {
      const normalized = units.normalizeAmount(nutrient, t.maxAmount, t.unit, input.dailyTargetCalories ?? NaN);
      if (!Number.isFinite(normalized.amount)) {
        limits.push({ nutrient, column, max: null, unit: t.unit, error: "limit could not be converted to a standard unit" });
      } else {
        limits.push({ nutrient, column, max: normalized.amount, unit: normalized.unit });
      }
    } catch (error) {
      limits.push({ nutrient, column, max: null, unit: t.unit, error: error instanceof Error ? error.message : "limit could not be converted" });
    }
  }

  for (const food of staples) {
    const allergens = findAllergens(food.foodName, input.allergies);
    if (allergens.length > 0) {
      removed.push({ foodId: food.id, foodName: food.foodName, reason: `Removed "${food.foodName}": you are allergic to ${allergens.join(", ")}.` });
      continue;
    }

    let overLimitReason: string | null = null;
    for (const limit of limits) {
      if (limit.error || limit.max == null || !limit.column) {
        unchecked.push({ foodId: food.id, nutrient: limit.nutrient, reason: limit.error ?? "limit unavailable" });
        continue;
      }
      const value = food[limit.column] as number | null | undefined;
      if (value == null) {
        unchecked.push({ foodId: food.id, nutrient: limit.nutrient, reason: "food has no value for this nutrient" });
        continue;
      }
      const overLimit = limit.max === 0 ? value > 0 : value >= CONDITION_MAX_SERVING_SHARE * limit.max;
      if (!overLimitReason && overLimit) {
        overLimitReason = `Removed "${food.foodName}": one serving has ${Math.round(value)} ${limit.unit} of ${limit.nutrient}, at least ${Math.round(CONDITION_MAX_SERVING_SHARE * 100)}% of your daily limit of ${Math.round(limit.max)} ${limit.unit}.`;
      }
    }
    if (overLimitReason) {
      removed.push({ foodId: food.id, foodName: food.foodName, reason: overLimitReason });
      continue;
    }
    safe.push(food);
  }

  return { safe, removed, unchecked };
}

export function allergenWarnings(foods: Pick<FoodNutritionEntity, "foodName">[], allergies: string[]): string[] {
  const warnings: string[] = [];
  for (const food of foods) {
    const allergens = findAllergens(food.foodName, allergies);
    if (allergens.length > 0) {
      warnings.push(`"${food.foodName}" may contain ${allergens.join(", ")}, which you are allergic to.`);
    }
  }
  return warnings;
}
