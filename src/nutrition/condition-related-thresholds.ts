import type { UserNutrientThreshold } from "./user-context.service";

export type ConditionNutrientRuleRef = {
  conditionKey: string;
  nutrient: string;
  minAmount: number | null;
  maxAmount: number | null;
  unit: string;
};

/** Nutrients from active condition rules, with min/max from user thresholds (fallback to rule defaults). */
export function buildConditionRelatedThresholds(
  conditionKeys: string[],
  userThresholds: UserNutrientThreshold[],
  rules: ConditionNutrientRuleRef[],
  normalizeNutrient: (nutrient: string) => string,
): UserNutrientThreshold[] {
  const active = new Set(conditionKeys.map((k) => k.trim().toLowerCase()).filter(Boolean));
  const activeRules = rules.filter((r) => active.has(r.conditionKey.trim().toLowerCase()));
  if (activeRules.length === 0) {
    return [];
  }

  const nutrientKeys = new Set(activeRules.map((r) => normalizeNutrient(r.nutrient)));
  const byNutrient = new Map<string, UserNutrientThreshold>();

  for (const t of userThresholds) {
    const key = normalizeNutrient(t.nutrient);
    if (nutrientKeys.has(key)) {
      byNutrient.set(key, t);
    }
  }

  const rulesByNutrient = new Map<string, ConditionNutrientRuleRef[]>();
  for (const rule of activeRules) {
    const key = normalizeNutrient(rule.nutrient);
    rulesByNutrient.set(key, [...(rulesByNutrient.get(key) ?? []), rule]);
  }

  for (const [key, nutrientRules] of rulesByNutrient.entries()) {
    if (byNutrient.has(key)) {
      continue;
    }
    let minAmount: number | null = null;
    let maxAmount: number | null = null;
    for (const rule of nutrientRules) {
      if (rule.minAmount != null) {
        minAmount = minAmount == null ? rule.minAmount : Math.max(minAmount, rule.minAmount);
      }
      if (rule.maxAmount != null) {
        maxAmount = maxAmount == null ? rule.maxAmount : Math.min(maxAmount, rule.maxAmount);
      }
    }
    byNutrient.set(key, {
      nutrient: nutrientRules[0].nutrient,
      minAmount,
      maxAmount,
      unit: nutrientRules[0].unit,
    });
  }

  return Array.from(byNutrient.values());
}

export function formatThresholdMinMax(t: UserNutrientThreshold): string {
  const name = String(t.nutrient || "").trim();
  if (!name) {
    return "";
  }
  const unit = String(t.unit || "").trim();
  const parts: string[] = [name];
  if (t.minAmount != null && Number.isFinite(Number(t.minAmount))) {
    parts.push(`min ${Number(t.minAmount)}${unit ? ` ${unit}` : ""}`);
  }
  if (t.maxAmount != null && Number.isFinite(Number(t.maxAmount))) {
    parts.push(`max ${Number(t.maxAmount)}${unit ? ` ${unit}` : ""}`);
  }
  return parts.join(" ");
}
