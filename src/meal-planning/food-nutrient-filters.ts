import { BadRequestException } from "@nestjs/common";
import type { FoodNutritionEntity } from "./entities/food-nutrition.entity";

const columns = {
  proteinG: "protein",
  totalCarbohydratesG: "carbs",
  totalFatG: "fat",
  dietaryFibersG: "fiber",
  sugarsG: "sugars",
  saturatedFatG: "saturatedFat",
  sodiumMg: "sodium",
} as const satisfies Record<string, keyof FoodNutritionEntity>;

type Nutrient = keyof typeof columns;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNutrient(key: string): key is Nutrient {
  return Object.prototype.hasOwnProperty.call(columns, key);
}

function isBound(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function invalidFilter(): never {
  throw new BadRequestException("Invalid nutrient filters. Use non-negative minimum and maximum amounts per serving.");
}

export function foodNutrientPredicates(raw: unknown): { sql: string; params: Record<string, number> }[] {
  if (raw === undefined) return [];
  if (typeof raw !== "string" || raw.length > 2048) return invalidFilter();

  let filters: unknown;
  try {
    filters = JSON.parse(raw);
  } catch {
    return invalidFilter();
  }
  if (!isObject(filters)) return invalidFilter();

  return Object.entries(filters).flatMap(([key, bounds]) => {
    if (!isNutrient(key) || !isObject(bounds) ||
      Object.keys(bounds).some((bound) => bound !== "min" && bound !== "max")) return invalidFilter();

    const { min, max } = bounds;
    if ((min === undefined && max === undefined) ||
      (min !== undefined && !isBound(min)) || (max !== undefined && !isBound(max)) ||
      (min !== undefined && max !== undefined && min > max)) return invalidFilter();

    const column = columns[key];
    const predicates = [];
    if (min !== undefined) predicates.push({ sql: `f.${column} >= :${key}Min`, params: { [key + "Min"]: min } });
    if (max !== undefined) predicates.push({ sql: `f.${column} <= :${key}Max`, params: { [key + "Max"]: max } });
    return predicates;
  });
}
