import type { ConditionRuleInput } from "./condition-nutrient-rule.types";

// Adult defaults with the guideline scope and references documented in
// docs/condition-nutrient-rules.md.
export const DEFAULT_CONDITION_NUTRIENT_RULES: ConditionRuleInput[] = [
  { conditionKey: "diabetes", nutrient: "fiber", minAmount: 14, maxAmount: null, unit: "g/1000kcal", rebalanceMode: "strict", isActive: true },
  { conditionKey: "diabetes", nutrient: "sodium", minAmount: null, maxAmount: 2300, unit: "mg", rebalanceMode: "strict", isActive: true },
  { conditionKey: "hypertension", nutrient: "sodium", minAmount: null, maxAmount: 1500, unit: "mg", rebalanceMode: "strict", isActive: true },
  { conditionKey: "heart_disease", nutrient: "saturatedFat", minAmount: null, maxAmount: 6, unit: "%kcal", rebalanceMode: "strict", isActive: true },
  { conditionKey: "high_cholesterol", nutrient: "saturatedFat", minAmount: null, maxAmount: 6, unit: "%kcal", rebalanceMode: "strict", isActive: true },
];
