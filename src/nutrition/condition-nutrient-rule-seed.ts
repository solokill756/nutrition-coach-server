import { ConditionRuleInput } from "./condition-nutrient-rule.types";

export const DEFAULT_CONDITION_NUTRIENT_RULES: ConditionRuleInput[] = [
  { conditionKey: "hypertension", nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg", rebalanceMode: "strict", isActive: true },
  { conditionKey: "high-blood-pressure", nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg", rebalanceMode: "strict", isActive: true },
  { conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: null, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
  { conditionKey: "diabetes", nutrient: "sugars", minAmount: null, maxAmount: 25, unit: "g", rebalanceMode: "strict", isActive: true },
  { conditionKey: "pre-diabetes", nutrient: "carbs", minAmount: 130, maxAmount: null, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
  { conditionKey: "pre-diabetes", nutrient: "sugars", minAmount: null, maxAmount: 25, unit: "g", rebalanceMode: "strict", isActive: true },
  { conditionKey: "heart_disease", nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg", rebalanceMode: "strict", isActive: true },
  { conditionKey: "heart_disease", nutrient: "saturatedFat", minAmount: null, maxAmount: 6, unit: "%kcal", rebalanceMode: "strict", isActive: true },
  { conditionKey: "heart_disease", nutrient: "cholesterol", minAmount: null, maxAmount: 300, unit: "mg", rebalanceMode: "strict", isActive: true },
  { conditionKey: "high_cholesterol", nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg", rebalanceMode: "strict", isActive: true },
  { conditionKey: "high_cholesterol", nutrient: "saturatedFat", minAmount: null, maxAmount: 6, unit: "%kcal", rebalanceMode: "strict", isActive: true },
  { conditionKey: "high_cholesterol", nutrient: "cholesterol", minAmount: null, maxAmount: 300, unit: "mg", rebalanceMode: "strict", isActive: true },
  { conditionKey: "kidney_disease", nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg", rebalanceMode: "strict", isActive: true },
  { conditionKey: "kidney_disease", nutrient: "protein", minAmount: null, maxAmount: 70, unit: "g", rebalanceMode: "auto_rebalance", isActive: true },
  { conditionKey: "kidney_disease", nutrient: "phosphorus", minAmount: null, maxAmount: 800, unit: "mg", rebalanceMode: "strict", isActive: true },
];
