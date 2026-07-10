import type { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import type { RecipeMealSlot } from "./dto/recipe.dto";

export const MEAL_SLOT_ORDER: RecipeMealSlot[] = ["breakfast", "lunch", "snack", "dinner"];

export type StapleAllocationMap = Partial<Record<RecipeMealSlot, number[]>>;

export type ValidateAllocationsParams = {
  allocations: StapleAllocationMap;
  generatingSlots: RecipeMealSlot[];
  stapleIds: Set<number>;
  stapleCount: number;
};

export type ValidateAllocationsResult =
  | { ok: true }
  | { ok: false; reason: string };

export function firstUnused(
  sorted: FoodNutritionEntity[],
  usedFoodIds: Set<number>,
): FoodNutritionEntity | undefined {
  return sorted.find((f) => !usedFoodIds.has(Number(f.id))) ?? sorted[0];
}

export function pickFoodsForSlotWithExclude(
  staples: FoodNutritionEntity[],
  mealSlot: RecipeMealSlot,
  usedFoodIds: Set<number>,
): FoodNutritionEntity[] {
  const max = mealSlot === "snack" ? 2 : 4;
  const usable = staples.filter((f) => Number(f.calories ?? 0) > 0);
  const foods = usable.length ? usable : staples;
  const byProtein = [...foods].sort((a, b) => Number(b.protein ?? 0) - Number(a.protein ?? 0));
  const byCarbs = [...foods].sort((a, b) => Number(b.carbs ?? 0) - Number(a.carbs ?? 0));
  const byFiber = [...foods].sort((a, b) => Number(b.fiber ?? 0) - Number(a.fiber ?? 0));
  const byCalories = [...foods].sort((a, b) => Number(b.calories ?? 0) - Number(a.calories ?? 0));

  const selected: FoodNutritionEntity[] = [];
  const add = (food: FoodNutritionEntity | undefined) => {
    if (food && !selected.some((item) => Number(item.id) === Number(food.id))) {
      selected.push(food);
    }
  };

  if (mealSlot === "snack") {
    add(firstUnused(byFiber, usedFoodIds) ?? firstUnused(byCarbs, usedFoodIds));
    add(firstUnused(byProtein, usedFoodIds));
  } else {
    add(firstUnused(byProtein, usedFoodIds));
    add(firstUnused(byCarbs, usedFoodIds));
    add(firstUnused(byFiber, usedFoodIds));
    if (mealSlot === "lunch" || mealSlot === "dinner") {
      add(firstUnused(byCalories, usedFoodIds));
    }
  }

  for (const food of foods) {
    if (selected.length >= max) break;
    if (selected.some((item) => Number(item.id) === Number(food.id))) continue;
    if (!usedFoodIds.has(Number(food.id))) add(food);
  }
  for (const food of foods) {
    if (selected.length >= max) break;
    add(food);
  }
  return selected.slice(0, max);
}

export function heuristicAllocateWithExclude(
  staples: FoodNutritionEntity[],
  generatingSlots: RecipeMealSlot[],
  initialUsed: Set<number> = new Set(),
): StapleAllocationMap {
  const ordered = MEAL_SLOT_ORDER.filter((s) => generatingSlots.includes(s));
  const used = new Set(initialUsed);
  const out: StapleAllocationMap = {};
  for (const slot of ordered) {
    const picked = pickFoodsForSlotWithExclude(staples, slot, used);
    out[slot] = picked.map((f) => Number(f.id));
    picked.forEach((f) => used.add(Number(f.id)));
  }
  return out;
}

export function validateAllocations(params: ValidateAllocationsParams): ValidateAllocationsResult {
  const { allocations, generatingSlots, stapleIds, stapleCount } = params;
  const allIds: number[] = [];

  for (const slot of generatingSlots) {
    const ids = allocations[slot];
    if (!Array.isArray(ids)) return { ok: false, reason: "missing_slot" };
    if (ids.length < 2 || ids.length > 4) return { ok: false, reason: "wrong_count" };
    const slotSet = new Set<number>();
    for (const raw of ids) {
      const id = Number(raw);
      if (!Number.isInteger(id) || !stapleIds.has(id)) return { ok: false, reason: "invalid_food_id" };
      if (slotSet.has(id)) return { ok: false, reason: "duplicate_in_slot" };
      slotSet.add(id);
      allIds.push(id);
    }
  }

  if (stapleCount >= generatingSlots.length * 2) {
    const minPreferredUnique = Math.min(generatingSlots.length * 2, stapleCount);
    const uniqueCount = new Set(allIds).size;
    if (uniqueCount < minPreferredUnique) return { ok: false, reason: "excessive_duplication" };
    const freq = new Map<number, number>();
    for (const id of allIds) freq.set(id, (freq.get(id) ?? 0) + 1);
    if ([...freq.values()].some((count) => count > 2)) {
      return { ok: false, reason: "excessive_duplication" };
    }
  }
  return { ok: true };
}

export function parseAllocationJson(raw: string): StapleAllocationMap | null {
  try {
    const cleaned = raw.replace(/```json\s*|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { allocations?: StapleAllocationMap };
    if (!parsed?.allocations || typeof parsed.allocations !== "object") return null;
    return parsed.allocations;
  } catch {
    return null;
  }
}
