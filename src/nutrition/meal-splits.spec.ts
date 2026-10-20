import {
  DEFAULT_MEAL_SPLITS,
  percentMealSplits,
  resolveMealSplits,
  validateMealSplits,
} from "./meal-splits";

describe("meal-splits", () => {
  it("accepts four whole percentages that add up to 100", () => {
    expect(validateMealSplits({ breakfast: 20, lunch: 40, dinner: 35, snack: 5 })).toEqual({
      breakfast: 20,
      lunch: 40,
      dinner: 35,
      snack: 5,
    });
    expect(validateMealSplits({ breakfast: 30, lunch: 40, dinner: 30, snack: 0 })).not.toBeNull();
  });

  it.each([
    ["a total of 95", { breakfast: 20, lunch: 40, dinner: 30, snack: 5 }],
    ["a decimal", { breakfast: 25.5, lunch: 34.5, dinner: 30, snack: 10 }],
    ["a string number", { breakfast: "25", lunch: 35, dinner: 30, snack: 10 }],
    ["a negative", { breakfast: -5, lunch: 45, dinner: 50, snack: 10 }],
    ["a missing meal", { breakfast: 30, lunch: 40, dinner: 30 }],
    ["an extra key", { breakfast: 25, lunch: 35, dinner: 30, snack: 10, brunch: 0 }],
    ["null", null],
    ["an array", [25, 35, 30, 10]],
  ])("rejects %s", (_label, input) => {
    expect(validateMealSplits(input)).toBeNull();
  });

  it("falls back to the default for missing or broken stored values", () => {
    expect(percentMealSplits(null)).toEqual(DEFAULT_MEAL_SPLITS);
    expect(percentMealSplits({ breakfast: 90 })).toEqual(DEFAULT_MEAL_SPLITS);
    expect(percentMealSplits(null)).not.toBe(DEFAULT_MEAL_SPLITS);
  });

  it("resolves stored percentages to fractions", () => {
    expect(resolveMealSplits(null)).toEqual({ breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 });
    expect(resolveMealSplits({ breakfast: 20, lunch: 40, dinner: 35, snack: 5 })).toEqual({
      breakfast: 0.2,
      lunch: 0.4,
      dinner: 0.35,
      snack: 0.05,
    });
  });
});
