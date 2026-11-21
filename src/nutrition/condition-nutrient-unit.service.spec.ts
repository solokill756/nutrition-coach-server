import { ConditionNutrientUnitService } from "./condition-nutrient-unit.service";

describe("ConditionNutrientUnitService", () => {
  const service = new ConditionNutrientUnitService();

  it("converts grams to canonical milligrams for sodium", () => {
    expect(service.normalizeAmount("sodium", 1.5, "g", 2000)).toEqual({ amount: 1500, unit: "mg" });
  });

  it("keeps macro grams as canonical grams", () => {
    expect(service.normalizeAmount("carbs", 180, "g", 2000)).toEqual({ amount: 180, unit: "g" });
  });

  it("converts saturated fat percent calories to grams", () => {
    expect(service.normalizeAmount("saturatedFat", 6, "%kcal", 2000)).toEqual({ amount: 13.3, unit: "g" });
  });

  it("converts a fiber density target to grams at the user's energy target", () => {
    expect(service.normalizeAmount("fiber", 14, "g/1000kcal", 2024)).toEqual({ amount: 28.3, unit: "g" });
  });

  it("rejects a fiber density unit for other nutrients", () => {
    expect(() => service.normalizeAmount("carbs", 14, "g/1000kcal", 2000)).toThrow("UNIT_INCOMPATIBLE");
  });

  it("converts carbs percent calories to grams with 4 kcal/g", () => {
    expect(service.normalizeAmount("carbs", 50, "%kcal", 2000)).toEqual({ amount: 250, unit: "g" });
  });

  it("converts protein percent calories to grams with 4 kcal/g", () => {
    expect(service.normalizeAmount("protein", 20, "% kcal", 2000)).toEqual({ amount: 100, unit: "g" });
  });

  it("converts fat percent calories to grams with 9 kcal/g", () => {
    expect(service.normalizeAmount("fat", 30, "%kcal", 1800)).toEqual({ amount: 60, unit: "g" });
  });

  it("rejects incompatible units", () => {
    expect(() => service.normalizeAmount("sodium", 10, "kcal", 2000)).toThrow("UNIT_INCOMPATIBLE");
  });
});
