import { Injectable } from "@nestjs/common";
import { CanonicalNutrientUnit, ConditionRuleAmount } from "./condition-nutrient-rule.types";

const MACRO_NUTRIENTS = new Set(["protein", "carbs", "fat", "fiber", "sugars", "saturatedfat"]);
const MG_NUTRIENTS = new Set([
  "sodium",
  "potassium",
  "calcium",
  "iron",
  "cholesterol",
  "magnesium",
  "phosphorus",
  "zinc",
]);
const UG_NUTRIENTS = new Set(["vitamina", "vitamind", "vitamink", "vitaminb12", "folatedfe"]);

@Injectable()
export class ConditionNutrientUnitService {
  normalizeNutrient(value: string): string {
    return value.trim().replace(/[_\s-]/g, "").toLowerCase();
  }

  canonicalUnit(nutrient: string): CanonicalNutrientUnit {
    const key = this.normalizeNutrient(nutrient);
    if (key === "calories") return "kcal";
    if (MACRO_NUTRIENTS.has(key)) return "g";
    if (MG_NUTRIENTS.has(key)) return "mg";
    if (UG_NUTRIENTS.has(key)) return "ug";
    throw new Error("NUTRIENT_UNSUPPORTED");
  }

  normalizeAmount(nutrient: string, amount: number, unit: string, targetCalories: number): ConditionRuleAmount {
    const canonical = this.canonicalUnit(nutrient);
    const source = unit.trim().toLowerCase();
    if (!Number.isFinite(amount) || amount < 0) throw new Error("AMOUNT_INVALID");
    if (source === canonical) return { amount: this.round(amount), unit: canonical };
    if (source === "g" && canonical === "mg") return { amount: this.round(amount * 1000), unit: "mg" };
    if (source === "mg" && canonical === "g") return { amount: this.round(amount / 1000), unit: "g" };
    if (source === "mg" && canonical === "ug") return { amount: this.round(amount * 1000), unit: "ug" };
    if (source === "ug" && canonical === "mg") return { amount: this.round(amount / 1000), unit: "mg" };
    if ((source === "%kcal" || source === "% kcal") && canonical === "g") {
      return { amount: this.round(((targetCalories * amount) / 100) / this.kcalPerGram(nutrient)), unit: "g" };
    }
    throw new Error("UNIT_INCOMPATIBLE");
  }

  private kcalPerGram(nutrientKey: string): 4 | 9 {
    const key = this.normalizeNutrient(nutrientKey);
    return key === "fat" || key === "saturatedfat" ? 9 : 4;
  }

  private round(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
