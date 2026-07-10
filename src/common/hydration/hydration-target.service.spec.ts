import { calculateDailyWaterTargetMl } from "./hydration-target.service";

describe("calculateDailyWaterTargetMl", () => {
  it("uses 35 ml/kg for sedentary users", () => {
    expect(calculateDailyWaterTargetMl({ weightKg: 60, fitnessLevel: "sedentary" })).toBe(2100);
  });

  it("applies activity multiplier and rounds to nearest 50 ml", () => {
    expect(calculateDailyWaterTargetMl({ weightKg: 70, fitnessLevel: "moderate" })).toBe(2700);
  });

  it("falls back by sex when weight is missing or invalid", () => {
    expect(calculateDailyWaterTargetMl({ weightKg: null, sex: "male" })).toBe(3000);
    expect(calculateDailyWaterTargetMl({ weightKg: 0, sex: "female" })).toBe(2200);
    expect(calculateDailyWaterTargetMl({ weightKg: -1, sex: null })).toBe(2500);
  });

  it("clamps very low and very high calculated targets", () => {
    expect(calculateDailyWaterTargetMl({ weightKg: 20, fitnessLevel: "sedentary" })).toBe(1500);
    expect(calculateDailyWaterTargetMl({ weightKg: 200, fitnessLevel: "very_active" })).toBe(5000);
  });
});
