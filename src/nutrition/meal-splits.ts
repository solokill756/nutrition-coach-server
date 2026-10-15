export const MEAL_SPLIT_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealSplitSlot = (typeof MEAL_SPLIT_SLOTS)[number];
/** Whole percent of the day's calories per meal; adds up to 100. */
export type MealSplitsPercent = Record<MealSplitSlot, number>;
/** The same split as fractions of the day (0.25 …). */
export type MealSplitsFraction = Record<MealSplitSlot, number>;

export const DEFAULT_MEAL_SPLITS: MealSplitsPercent = {
  breakfast: 25,
  lunch: 35,
  dinner: 30,
  snack: 10,
};

/** The split if it is exactly four whole percentages (0–100) adding up to 100, else null. */
export function validateMealSplits(input: unknown): MealSplitsPercent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (
    keys.length !== MEAL_SPLIT_SLOTS.length ||
    !MEAL_SPLIT_SLOTS.every((slot) => keys.includes(slot))
  ) {
    return null;
  }
  const out = {} as MealSplitsPercent;
  let total = 0;
  for (const slot of MEAL_SPLIT_SLOTS) {
    const value = obj[slot];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
      return null;
    }
    out[slot] = value;
    total += value;
  }
  return total === 100 ? out : null;
}

/** A stored split, or the default when it is missing or broken (never throws). */
export function percentMealSplits(stored: unknown): MealSplitsPercent {
  return validateMealSplits(stored) ?? { ...DEFAULT_MEAL_SPLITS };
}

export function resolveMealSplits(stored: unknown): MealSplitsFraction {
  const percent = percentMealSplits(stored);
  return {
    breakfast: percent.breakfast / 100,
    lunch: percent.lunch / 100,
    dinner: percent.dinner / 100,
    snack: percent.snack / 100,
  };
}
