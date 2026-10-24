import { ConditionNutrientUnitService } from "../nutrition/condition-nutrient-unit.service";
import type { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import type { UserNutrientThreshold } from "../nutrition/user-context.service";
import { allergenWarnings, filterSafeStaples } from "./safe-staples";

const units = new ConditionNutrientUnitService();
const food = (over: Partial<FoodNutritionEntity>) =>
  ({ id: 1, foodName: "Food", calories: 100, protein: 1, carbs: 1, fat: 1, fiber: 1, sugars: 1, saturatedFat: 1, sodium: 0, potassium: 0, calcium: 0, iron: 0, magnesium: 0, phosphorus: 0, zinc: 0, cholesterol: 0, ...over }) as FoodNutritionEntity;
const th = (nutrient: string, maxAmount: number | null, minAmount: number | null, unit: string): UserNutrientThreshold => ({ nutrient, maxAmount, minAmount, unit });
const base = { allergies: [] as string[], conditionRelatedThresholds: [] as UserNutrientThreshold[], dailyTargetCalories: 2000 as number | null };

describe("filterSafeStaples", () => {
  it("removes allergen foods", () => {
    const r = filterSafeStaples([food({ id: 1, foodName: "Trứng gà" })], { ...base, allergies: ["Eggs"] }, units);
    expect(r.safe.find((f) => f.id === 1)).toBeUndefined();
    expect(r.removed[0].reason).toBe('Removed "Trứng gà": you are allergic to Eggs.');
  });

  it("removes a food whose serving is >= 80% of the daily max", () => {
    const r = filterSafeStaples([food({ id: 2, foodName: "Nước mắm", sodium: 1600 })], { ...base, conditionRelatedThresholds: [th("sodium", 2000, null, "mg")] }, units);
    expect(r.safe).toHaveLength(0);
    expect(r.removed[0].reason).toBe('Removed "Nước mắm": one serving has 1600 mg of sodium, at least 80% of your daily limit of 2000 mg.');
  });

  it("keeps a food under 80%", () => {
    const r = filterSafeStaples([food({ id: 3, sodium: 1500 })], { ...base, conditionRelatedThresholds: [th("sodium", 2000, null, "mg")] }, units);
    expect(r.safe.map((f) => f.id)).toEqual([3]);
  });

  it("ignores min-only thresholds", () => {
    const r = filterSafeStaples([food({ id: 4, potassium: 0 })], { ...base, conditionRelatedThresholds: [th("potassium", null, 3500, "mg")] }, units);
    expect(r.safe.map((f) => f.id)).toEqual([4]);
  });

  it("keeps and reports when value is null", () => {
    const r = filterSafeStaples([food({ id: 5, sodium: null })], { ...base, conditionRelatedThresholds: [th("sodium", 2000, null, "mg")] }, units);
    expect(r.safe.map((f) => f.id)).toEqual([5]);
    expect(r.unchecked).toEqual([expect.objectContaining({ foodId: 5, nutrient: "sodium" })]);
  });

  it("keeps and reports %kcal without calorie target", () => {
    const r = filterSafeStaples([food({ id: 6, carbs: 100 })], { ...base, dailyTargetCalories: null, conditionRelatedThresholds: [th("carbs", 45, null, "%kcal")] }, units);
    expect(r.safe.map((f) => f.id)).toEqual([6]);
    expect(r.unchecked).toHaveLength(1);
  });
});

describe("allergenWarnings", () => {
  it("allergenWarnings copy", () => {
    expect(allergenWarnings([{ foodName: "Trứng gà" }], ["Eggs"])).toEqual(['"Trứng gà" may contain Eggs, which you are allergic to.']);
  });
});
