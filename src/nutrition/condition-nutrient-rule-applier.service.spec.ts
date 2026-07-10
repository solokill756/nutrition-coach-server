import { ConditionNutrientRuleApplierService } from "./condition-nutrient-rule-applier.service";
import { ConditionNutrientUnitService } from "./condition-nutrient-unit.service";
import { UserNutritionalThresholdEntity } from "./entities/user-nutritional-threshold.entity";
import { MacroPercentages } from "./condition-nutrient-rule.types";

function threshold(nutrient: string, minAmount: number | null, maxAmount: number | null, unit: string): UserNutritionalThresholdEntity {
  return { nutrient, minAmount, maxAmount, unit, isActive: true, origin: "system" } as UserNutritionalThresholdEntity;
}

describe("ConditionNutrientRuleApplierService", () => {
  const service = new ConditionNutrientRuleApplierService(new ConditionNutrientUnitService());

  const defaultPct: MacroPercentages = { proteinPercent: 25, carbsPercent: 55, fatPercent: 20 };

  it("updates only nutrients managed by active condition rules", () => {
    const result = service.applyRules({
      targetCalories: 2000,
      baseThresholds: [
        threshold("carbs", 225, 275, "g"),
        threshold("protein", 88, 112, "g"),
        threshold("sugars", null, 50, "g"),
      ],
      activeConditionKeys: ["diabetes"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 200, unit: "g", rebalanceMode: "strict", isActive: true },
        { id: 2, conditionKey: "diabetes", nutrient: "sugars", minAmount: null, maxAmount: 25, unit: "g", rebalanceMode: "strict", isActive: true },
      ],
      allowAutoRebalance: false,
    });

    expect(result.thresholds.find((x) => x.nutrient === "carbs")).toMatchObject({ minAmount: 130, maxAmount: 200, origin: "admin_rule" });
    expect(result.thresholds.find((x) => x.nutrient === "sugars")).toMatchObject({ maxAmount: 25, origin: "admin_rule" });
    expect(result.thresholds.find((x) => x.nutrient === "protein")).toMatchObject({ minAmount: 88, maxAmount: 112, origin: "system" });
  });

  it("uses strictest range when multiple conditions manage one nutrient", () => {
    const result = service.applyRules({
      targetCalories: 2000,
      baseThresholds: [threshold("sodium", null, 2300, "mg")],
      activeConditionKeys: ["hypertension", "kidney_disease"],
      rules: [
        { id: 1, conditionKey: "hypertension", nutrient: "sodium", minAmount: null, maxAmount: 1500, unit: "mg", rebalanceMode: "strict", isActive: true },
        { id: 2, conditionKey: "kidney_disease", nutrient: "sodium", minAmount: 500, maxAmount: 1400, unit: "mg", rebalanceMode: "strict", isActive: true },
      ],
      allowAutoRebalance: false,
    });

    expect(result.thresholds[0]).toMatchObject({ minAmount: 500, maxAmount: 1400 });
  });

  it("falls back to strict for auto rebalance when no macro is safe", () => {
    const result = service.applyRules({
      targetCalories: 2000,
      baseThresholds: [
        threshold("carbs", 225, 275, "g"),
        threshold("protein", 88, 112, "g"),
        threshold("fat", 49, 61, "g"),
      ],
      activeConditionKeys: ["diabetes", "kidney_disease", "heart_disease"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 180, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
        { id: 2, conditionKey: "kidney_disease", nutrient: "protein", minAmount: null, maxAmount: 80, unit: "g", rebalanceMode: "strict", isActive: true },
        { id: 3, conditionKey: "heart_disease", nutrient: "fat", minAmount: null, maxAmount: 50, unit: "g", rebalanceMode: "strict", isActive: true },
      ],
      allowAutoRebalance: true,
    });

    expect(result.rebalance.status).toBe("fallback_strict");
    expect(result.warnings).toContain("AUTO_REBALANCE_NO_SAFE_MACRO");
  });

  // --- NEW TESTS: Safe Macro Rebalance ---

  function fullMacros(): UserNutritionalThresholdEntity[] {
    return [
      threshold("protein", 100, 125, "g"),
      threshold("carbs", 250, 300, "g"),
      threshold("fat", 50, 65, "g"),
    ];
  }

  it("distributes deficit proportionally among unlocked macros", () => {
    // targetCal = 2500, macros mid: P=112.5g(450cal) C=275g(1100cal) F=57.5g(518cal) total=2068
    // deficit = 432 cal
    // Only protein + fat unlocked (carbs locked by rule)
    // Re-normalized: protein 25/(25+20)=55.6%, fat 44.4%
    // Protein share: 432*0.556=240cal => +60g (cap 70*2.5=175 => ok)
    // Fat share: 432*0.444=192cal => +21g (cap 2500*0.35/9=97g => ok)
    const result = service.applyRules({
      targetCalories: 2500,
      baseThresholds: fullMacros(),
      activeConditionKeys: ["diabetes"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 200, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
      ],
      allowAutoRebalance: true,
      macroPercentages: defaultPct,
      bodyWeightKg: 70,
    });

    const protein = result.thresholds.find((x) => x.nutrient === "protein")!;
    const fat = result.thresholds.find((x) => x.nutrient === "fat")!;
    expect(protein.maxAmount).toBeGreaterThan(125); // was increased
    expect(fat.maxAmount).toBeGreaterThan(65); // was increased
    expect(result.rebalance.status).toBe("applied");
    expect(result.rebalance.adjustedNutrients).toContain("protein");
    expect(result.rebalance.adjustedNutrients).toContain("fat");
  });

  it("caps protein at 2.5 g/kg body weight", () => {
    // bodyWeight=50kg, cap=125g. Base protein max=125g. Deficit ~400 cal
    // Protein share: ~222cal => +55g => 180g -> capped at 125g
    const result = service.applyRules({
      targetCalories: 2500,
      baseThresholds: fullMacros(),
      activeConditionKeys: ["diabetes"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 200, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
      ],
      allowAutoRebalance: true,
      macroPercentages: defaultPct,
      bodyWeightKg: 50,
    });

    const protein = result.thresholds.find((x) => x.nutrient === "protein")!;
    expect(protein.maxAmount).toBeLessThanOrEqual(125); // 50 * 2.5 = 125
  });

  it("caps fat at 35% of targetCalories", () => {
    // targetCal=2000, cap=2000*0.35/9=77.8g. Base fat max=65g
    // Deficit large enough that fat would push past cap
    const result = service.applyRules({
      targetCalories: 2000,
      baseThresholds: fullMacros(),
      activeConditionKeys: ["diabetes"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 150, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
      ],
      allowAutoRebalance: true,
      macroPercentages: defaultPct,
      bodyWeightKg: 70,
    });

    const fat = result.thresholds.find((x) => x.nutrient === "fat")!;
    expect(fat.maxAmount).toBeLessThanOrEqual(Math.round(2000 * 0.35 / 9 * 10) / 10);
  });

  it("caps carbs at 65% of targetCalories", () => {
    // targetCal=2000, cap=2000*0.65/4=325g. Base carbs max=300g
    // Fat locked, protein locked -> all deficit goes to carbs
    const result = service.applyRules({
      targetCalories: 2000,
      baseThresholds: fullMacros(),
      activeConditionKeys: ["diabetes", "kidney_disease", "heart_disease"],
      rules: [
        { id: 1, conditionKey: "kidney_disease", nutrient: "protein", minAmount: null, maxAmount: 80, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
        { id: 2, conditionKey: "heart_disease", nutrient: "fat", minAmount: null, maxAmount: 40, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
        { id: 3, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 300, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
      ],
      allowAutoRebalance: true,
      macroPercentages: defaultPct,
      bodyWeightKg: 70,
    });

    const carbs = result.thresholds.find((x) => x.nutrient === "carbs")!;
    const cap = Math.round(2000 * 0.65 / 4 * 10) / 10;
    expect(carbs.maxAmount).toBeLessThanOrEqual(cap);
  });

  it("recovers full deficit when caps not hit — no partial warning", () => {
    // Small deficit, caps far away
    const result = service.applyRules({
      targetCalories: 2100,
      baseThresholds: fullMacros(),
      activeConditionKeys: ["diabetes"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 280, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
      ],
      allowAutoRebalance: true,
      macroPercentages: defaultPct,
      bodyWeightKg: 100,
    });

    expect(result.warnings).not.toContain(expect.stringContaining("REBALANCE_PARTIAL"));
    expect(result.rebalance.status).toBe("applied");
  });

  it("emits REBALANCE_PARTIAL warning when caps prevent full recovery", () => {
    // Very low bodyWeight=40kg → protein cap=100g, tight
    // Large deficit
    const result = service.applyRules({
      targetCalories: 2500,
      baseThresholds: fullMacros(),
      activeConditionKeys: ["diabetes"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 150, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
      ],
      allowAutoRebalance: true,
      macroPercentages: defaultPct,
      bodyWeightKg: 40,
    });

    expect(result.warnings.some((w) => w.startsWith("REBALANCE_PARTIAL"))).toBe(true);
    expect(result.rebalance.status).toBe("applied");
  });

  it("single unlocked macro gets full deficit (within cap)", () => {
    // Only fat unlocked
    const result = service.applyRules({
      targetCalories: 2200,
      baseThresholds: fullMacros(),
      activeConditionKeys: ["diabetes", "kidney_disease"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 200, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
        { id: 2, conditionKey: "kidney_disease", nutrient: "protein", minAmount: null, maxAmount: 80, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
      ],
      allowAutoRebalance: true,
      macroPercentages: defaultPct,
      bodyWeightKg: 70,
    });

    const fat = result.thresholds.find((x) => x.nutrient === "fat")!;
    expect(fat.maxAmount).toBeGreaterThan(65); // increased
    expect(result.rebalance.adjustedNutrients).toEqual(["fat"]);
  });

  it("no bodyWeightKg uses default 70 kg protein cap", () => {
    // Cap = 70*2.5 = 175g
    const result = service.applyRules({
      targetCalories: 2500,
      baseThresholds: fullMacros(),
      activeConditionKeys: ["diabetes"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 150, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
      ],
      allowAutoRebalance: true,
      macroPercentages: defaultPct,
      // bodyWeightKg omited
    });

    const protein = result.thresholds.find((x) => x.nutrient === "protein")!;
    expect(protein.maxAmount).toBeLessThanOrEqual(175); // 70 * 2.5 = 175
  });

  it("deficit <= 0 returns not_requested", () => {
    // No rules that restrict macros — baseline already exceeds target
    const result = service.applyRules({
      targetCalories: 1600,
      baseThresholds: fullMacros(), // Baseline ~2068 cal > 1600
      activeConditionKeys: ["diabetes"],
      rules: [],
      allowAutoRebalance: true,
    });

    expect(result.rebalance.status).toBe("not_requested");
  });

  it("missing macroPercentages falls back to default P25/C55/F20", () => {
    // Should not crash, should use hardcoded default
    const result = service.applyRules({
      targetCalories: 2500,
      baseThresholds: fullMacros(),
      activeConditionKeys: ["diabetes"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 150, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
      ],
      allowAutoRebalance: true,
      bodyWeightKg: 70,
      // macroPercentages omitted
    });

    expect(result.rebalance.status).toBe("applied");
  });

  it("existing strict-mode tests still pass unchanged", () => {
    // Re-run first test identically
    const result = service.applyRules({
      targetCalories: 2000,
      baseThresholds: [
        threshold("carbs", 225, 275, "g"),
        threshold("protein", 88, 112, "g"),
        threshold("sugars", null, 50, "g"),
      ],
      activeConditionKeys: ["diabetes"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 200, unit: "g", rebalanceMode: "strict", isActive: true },
        { id: 2, conditionKey: "diabetes", nutrient: "sugars", minAmount: null, maxAmount: 25, unit: "g", rebalanceMode: "strict", isActive: true },
      ],
      allowAutoRebalance: false,
    });

    expect(result.thresholds.find((x) => x.nutrient === "carbs")).toMatchObject({ minAmount: 130, maxAmount: 200, origin: "admin_rule" });
    expect(result.thresholds.find((x) => x.nutrient === "sugars")).toMatchObject({ maxAmount: 25, origin: "admin_rule" });
    expect(result.thresholds.find((x) => x.nutrient === "protein")).toMatchObject({ minAmount: 88, maxAmount: 112, origin: "system" });
  });

  it("rebalances when allowAutoRebalance is true and a macro rule applies, regardless of rebalanceMode column", () => {
    const result = service.applyRules({
      targetCalories: 2000,
      baseThresholds: [
        threshold("carbs", 225, 275, "g"),
        threshold("protein", 88, 112, "g"),
        threshold("fat", 44, 56, "g"),
      ],
      activeConditionKeys: ["diabetes"],
      rules: [
        { id: 1, conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: 150, unit: "g", rebalanceMode: "strict", isActive: true },
      ],
      allowAutoRebalance: true,
      macroPercentages: defaultPct,
    });

    expect(result.rebalance.status).toBe("applied");
    expect(result.rebalance.adjustedNutrients.length).toBeGreaterThan(0);
  });
});
