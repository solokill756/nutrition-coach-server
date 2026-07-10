import { Injectable } from "@nestjs/common";
import { ConditionRuleInput, MacroPercentages } from "./condition-nutrient-rule.types";
import { ConditionNutrientUnitService } from "./condition-nutrient-unit.service";
import { UserNutritionalThresholdEntity } from "./entities/user-nutritional-threshold.entity";

type ApplyInput = {
  targetCalories: number;
  baseThresholds: UserNutritionalThresholdEntity[];
  activeConditionKeys: string[];
  rules: ConditionRuleInput[];
  allowAutoRebalance: boolean;
  macroPercentages?: MacroPercentages;
  bodyWeightKg?: number;
};

type RebalanceStatus = "not_requested" | "applied" | "fallback_strict";

@Injectable()
export class ConditionNutrientRuleApplierService {
  constructor(private readonly units: ConditionNutrientUnitService) {}

  applyRules(input: ApplyInput): {
    thresholds: UserNutritionalThresholdEntity[];
    changedNutrients: string[];
    warnings: string[];
    rebalance: { status: RebalanceStatus; adjustedNutrients: string[] };
  } {
    const warnings: string[] = [];

    // --- Layer 1: base threshold cloning ---
    const thresholds = input.baseThresholds.map((row) => ({ ...row }));

    if (input.rules.length === 0 || input.activeConditionKeys.length === 0) {
      const rebalance = this.rebalanceMacros(
        thresholds,
        input.targetCalories,
        new Set(),
        input.allowAutoRebalance,
        input.macroPercentages,
        input.bodyWeightKg,
      );
      warnings.push(...rebalance.warnings);
      return {
        thresholds,
        changedNutrients: [...rebalance.adjustedNutrients],
        warnings,
        rebalance: { status: rebalance.status, adjustedNutrients: rebalance.adjustedNutrients },
      };
    }

    // --- Layer 2: disease rule application ---
    const active = new Set(input.activeConditionKeys.map((x) => x.trim().toLowerCase()));
    const rules = input.rules.filter((rule) => rule.isActive && active.has(rule.conditionKey.trim().toLowerCase()));
    const lockedNutrients = new Set(rules.map((rule) => this.units.normalizeNutrient(rule.nutrient)));
    const byNutrient = new Map<string, ConditionRuleInput[]>();

    for (const rule of rules) {
      const key = this.units.normalizeNutrient(rule.nutrient);
      byNutrient.set(key, [...(byNutrient.get(key) ?? []), rule]);
    }

    const changedNutrients: string[] = [];

    for (const [key, nutrientRules] of byNutrient.entries()) {
      const row = thresholds.find((item) => this.units.normalizeNutrient(item.nutrient) === key);
      const target = row ?? ({ nutrient: nutrientRules[0].nutrient, minAmount: null, maxAmount: null, unit: this.units.canonicalUnit(key), isActive: true } as UserNutritionalThresholdEntity);
      let minAmount: number | null = null;
      let maxAmount: number | null = null;
      let sourceRuleId: number | null = null;
      let sourceConditionKey: string | null = null;

      for (const rule of nutrientRules) {
        const min = rule.minAmount == null ? null : this.units.normalizeAmount(rule.nutrient, rule.minAmount, rule.unit, input.targetCalories).amount;
        const max = rule.maxAmount == null ? null : this.units.normalizeAmount(rule.nutrient, rule.maxAmount, rule.unit, input.targetCalories).amount;
        if (min != null) minAmount = minAmount == null ? min : Math.max(minAmount, min);
        if (max != null) maxAmount = maxAmount == null ? max : Math.min(maxAmount, max);
        sourceRuleId = rule.id ?? null;
        sourceConditionKey = rule.conditionKey;
      }

      if (minAmount != null && maxAmount != null && minAmount > maxAmount) {
        warnings.push(`RULE_RANGE_CONFLICT:${key}`);
        minAmount = maxAmount;
      }

      target.minAmount = minAmount;
      target.maxAmount = maxAmount;
      target.unit = this.units.canonicalUnit(key);
      target.origin = "admin_rule";
      target.sourceRuleId = sourceRuleId;
      target.sourceConditionKey = sourceConditionKey;
      if (!row) thresholds.push(target);
      changedNutrients.push(target.nutrient);
    }

    // --- Layer 3: rebalance ---
    const rebalance = this.rebalanceMacros(
      thresholds,
      input.targetCalories,
      lockedNutrients,
      input.allowAutoRebalance,
      input.macroPercentages,
      input.bodyWeightKg,
    );
    warnings.push(...rebalance.warnings);
    return {
      thresholds,
      changedNutrients: [...new Set([...changedNutrients, ...rebalance.adjustedNutrients])],
      warnings,
      rebalance: { status: rebalance.status, adjustedNutrients: rebalance.adjustedNutrients },
    };
  }

  private rebalanceMacros(
    thresholds: UserNutritionalThresholdEntity[],
    targetCalories: number,
    lockedNutrients: Set<string>,
    allowAutoRebalance: boolean,
    macroPercentages?: MacroPercentages,
    bodyWeightKg?: number,
  ): { status: RebalanceStatus; adjustedNutrients: string[]; warnings: string[] } {
    const macroKeys = new Set(["protein", "carbs", "fat"]);
    const hasMacroRule = [...lockedNutrients].some((nutrient) => macroKeys.has(nutrient));
    const wantsRebalance = allowAutoRebalance && hasMacroRule;
    if (!wantsRebalance) return { status: "not_requested", adjustedNutrients: [], warnings: [] };

    // 1. Find protein/carbs/fat rows
    const pick = (n: string) => thresholds.find((t) => this.units.normalizeNutrient(t.nutrient) === n);
    const protein = pick("protein");
    const carbs = pick("carbs");
    const fat = pick("fat");
    if (!protein || !carbs || !fat) {
      return { status: "fallback_strict", adjustedNutrients: [], warnings: ["AUTO_REBALANCE_MISSING_MACRO"] };
    }

    // 2. Calculate current caloric total (midpoint of min/max for each macro)
    const midpoint = (min: number | null | undefined, max: number | null | undefined): number => {
      const a = min ?? 0;
      const b = max ?? a;
      return (a + b) / 2;
    };

    const currentCalories =
      midpoint(protein.minAmount, protein.maxAmount) * 4 +
      midpoint(carbs.minAmount, carbs.maxAmount) * 4 +
      midpoint(fat.minAmount, fat.maxAmount) * 9;

    const deficit = Math.round(targetCalories - currentCalories);
    if (deficit <= 1) return { status: "not_requested", adjustedNutrients: [], warnings: [] };

    // 3. Find unlocked macros
    const allMacros = ["protein", "carbs", "fat"] as const;
    const unlocked = allMacros.filter((n) => !lockedNutrients.has(n));
    if (unlocked.length === 0) {
      return { status: "fallback_strict", adjustedNutrients: [], warnings: ["AUTO_REBALANCE_NO_SAFE_MACRO"] };
    }

    // 4. Re-normalize percentages among unlocked macros
    const pct = macroPercentages ?? { proteinPercent: 25, carbsPercent: 55, fatPercent: 20 };
    const pctMap: Record<string, number> = {
      protein: pct.proteinPercent,
      carbs: pct.carbsPercent,
      fat: pct.fatPercent,
    };
    const totalPct = unlocked.reduce((sum, n) => sum + pctMap[n], 0);
    if (totalPct <= 0) {
      return { status: "fallback_strict", adjustedNutrients: [], warnings: ["AUTO_REBALANCE_ZERO_PCT"] };
    }

    // 5. Distribute deficit proportionally among unlocked macros
    const macroRowMap: Record<string, UserNutritionalThresholdEntity> = { protein, carbs, fat };
    const adjustedNutrients: string[] = [];

    for (const macro of unlocked) {
      const row = macroRowMap[macro];
      const calPerGram = macro === "fat" ? 9 : 4;
      const share = pctMap[macro] / totalPct;
      const extraG = Math.round((deficit * share / calPerGram) * 10) / 10;
      if (extraG <= 0) continue;

      if (row.maxAmount != null) {
        row.maxAmount = Math.round((row.maxAmount + extraG) * 10) / 10;
      } else if (row.minAmount != null) {
        row.minAmount = Math.round((row.minAmount + extraG) * 10) / 10;
      } else {
        row.minAmount = extraG;
      }
      row.origin = "rebalance";
      adjustedNutrients.push(row.nutrient);
    }

    return { status: "applied", adjustedNutrients, warnings: [] };
  }
}
