export type ConditionRuleRebalanceMode = "strict" | "auto_rebalance";

export type CanonicalNutrientUnit = "g" | "mg" | "ug" | "kcal";

export type MacroPercentages = {
  proteinPercent: number;
  carbsPercent: number;
  fatPercent: number;
};

export type ConditionRuleAmount = {
  amount: number;
  unit: CanonicalNutrientUnit;
};

export type ConditionRuleInput = {
  id?: number;
  conditionKey: string;
  nutrient: string;
  minAmount: number | null;
  maxAmount: number | null;
  unit: string;
  rebalanceMode: ConditionRuleRebalanceMode;
  isActive: boolean;
};
