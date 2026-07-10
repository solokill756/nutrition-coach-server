import { Injectable } from "@nestjs/common";
import { UserNutritionalThresholdEntity } from "./entities/user-nutritional-threshold.entity";

export type NutritionPlanInput = {
  gender: string | null;
  age: number | null;
  heightCm: number | null;
  currentWeightKg: number | null;
  activityLevel: string | null;
  goalType: string | null;
};

export type MacroBreakdown = {
  carbsG: number;
  proteinG: number;
  fatG: number;
  carbsPercent: number;
  proteinPercent: number;
  fatPercent: number;
};

export type NutritionPlanResult = {
  bmr: number;
  tdee: number;
  targetCalories: number;
} & MacroBreakdown;

const MIN_DAILY_CALORIES = 1200;
const WEIGHT_LOSS_DEFICIT_KCAL = 500;
/** Max deficit when default −500 would cross TDEE (cap at −300 kcal from TDEE). */
const WEIGHT_LOSS_SOFT_DEFICIT_KCAL = 300;
const WEIGHT_GAIN_SURPLUS_KCAL = 400;
const MUSCLE_GAIN_SURPLUS_KCAL = 250;
const MAX_SURPLUS_KCAL = 500;
const FDA_CHOLESTEROL_DAILY_VALUE_MG = 300;
const FDA_POTASSIUM_DAILY_VALUE_MG = 4700;

const KNOWN_GOAL_SLUGS = new Set([
  "weight_loss",
  "maintenance",
  "weight_gain",
  "muscle_gain",
  "modify_diet",
  "plan_meals",
  "manage_stress",
  "stay_active",
]);

@Injectable()
export class NutritionCalculatorService {
  /** Normalize slug; unknown → maintenance. */
  normalizeGoalType(goalType: string | null): string {
    const raw = (goalType || "").trim().toLowerCase();
    if (!raw) return "maintenance";
    if (KNOWN_GOAL_SLUGS.has(raw)) return raw;
    if (raw.includes("muscle")) return "muscle_gain";
    if (raw.includes("weight") && raw.includes("gain")) return "weight_gain";
    if (raw.includes("loss") || raw.includes("lose")) return "weight_loss";
    if (raw.includes("gain")) return "weight_gain";
    return "maintenance";
  }

  /**
   * Target daily calories after BMR/TDEE and goal.
   * weight_loss: TDEE − 500, floor 1200; if still ≥ TDEE, relax to −300 then −100.
   * lifestyle goals (modify_diet, plan_meals, …): TDEE (macros use maintenance profile).
   */
  resolveTargetCalories(tdee: number, goalType: string | null): number {
    const g = this.normalizeGoalType(goalType);
    const tdeeR = Math.round(tdee);
    switch (g) {
      case "weight_loss": {
        let t = Math.round(
          Math.max(MIN_DAILY_CALORIES, tdeeR - WEIGHT_LOSS_DEFICIT_KCAL),
        );
        if (t >= tdeeR) {
          t = Math.round(
            Math.max(MIN_DAILY_CALORIES, tdeeR - WEIGHT_LOSS_SOFT_DEFICIT_KCAL),
          );
        }
        if (t >= tdeeR) {
          t = Math.round(Math.max(800, tdeeR - 100));
        }
        if (t >= tdeeR) {
          t = Math.max(800, tdeeR - 50);
        }
        return t;
      }
      case "weight_gain": {
        const surplus = Math.min(WEIGHT_GAIN_SURPLUS_KCAL, MAX_SURPLUS_KCAL);
        return Math.round(tdeeR + surplus);
      }
      case "muscle_gain":
        return Math.round(
          tdeeR + Math.min(MUSCLE_GAIN_SURPLUS_KCAL, MAX_SURPLUS_KCAL),
        );
      case "maintenance":
      case "modify_diet":
      case "plan_meals":
      case "manage_stress":
      case "stay_active":
      default:
        return tdeeR;
    }
  }

  /**
   * @deprecated Use {@link resolveTargetCalories} — kept for any external callers.
   */
  adjustCaloriesByGoal(tdee: number, goalType: string | null): number {
    return this.resolveTargetCalories(tdee, goalType);
  }

  /** Safe body weight for g/kg macros (kg). */
  private safeWeightKg(currentWeightKg: number | null | undefined): number {
    const w = currentWeightKg ?? 70;
    return Math.min(200, Math.max(30, w));
  }

  macroBreakdownForGoal(
    input: NutritionPlanInput & { targetCalories: number },
  ): MacroBreakdown {
    const T = Math.max(1, Math.round(input.targetCalories));
    const w = this.safeWeightKg(input.currentWeightKg);
    const g = this.normalizeGoalType(input.goalType);

    let proteinG: number;
    let carbCalShareOfRemainder: number;
    let fatCalShareOfRemainder: number;

    switch (g) {
      case "weight_loss":
        proteinG = Math.round(1.8 * w * 10) / 10;
        carbCalShareOfRemainder = 50 / 85;
        fatCalShareOfRemainder = 35 / 85;
        break;
      case "weight_gain":
        proteinG = Math.round(1.4 * w * 10) / 10;
        carbCalShareOfRemainder = 0.62;
        fatCalShareOfRemainder = 0.38;
        break;
      case "muscle_gain":
        proteinG = Math.round(1.9 * w * 10) / 10;
        carbCalShareOfRemainder = 0.62;
        fatCalShareOfRemainder = 0.38;
        break;
      case "maintenance":
      case "modify_diet":
      case "plan_meals":
      case "manage_stress":
      case "stay_active":
      default:
        proteinG = Math.round(1.2 * w * 10) / 10;
        carbCalShareOfRemainder = 55 / 85;
        fatCalShareOfRemainder = 30 / 85;
        break;
    }

    const proteinCals = proteinG * 4;
    let remainder = T - proteinCals;
    if (remainder < T * 0.15) {
      proteinG = Math.round(((T * 0.22) / 4) * 10) / 10;
      remainder = T - proteinG * 4;
    }
    remainder = Math.max(0, remainder);
    const carbCals = remainder * carbCalShareOfRemainder;
    const fatCals = remainder * fatCalShareOfRemainder;
    let carbsG = Math.round((carbCals / 4) * 10) / 10;
    let fatG = Math.round((fatCals / 9) * 10) / 10;

    return this.scaleMacrosToCalorieTarget(T, proteinG, carbsG, fatG);
  }

  /**
   * Legacy balanced bands (fallback); kept if scaling fails.
   */
  macroBreakdownFromTargetCalories(targetCalories: number): MacroBreakdown {
    const T = targetCalories;
    const pMin = (T * 0.2) / 4;
    const pMax = (T * 0.35) / 4;
    const cMin = (T * 0.4) / 4;
    const cMax = (T * 0.55) / 4;
    const fMin = (T * 0.2) / 9;
    const fMax = (T * 0.3) / 9;
    const proteinG = Math.round(((pMin + pMax) / 2) * 10) / 10;
    const carbsG = Math.round(((cMin + cMax) / 2) * 10) / 10;
    const fatG = Math.round(((fMin + fMax) / 2) * 10) / 10;
    return this.scaleMacrosToCalorieTarget(T, proteinG, carbsG, fatG);
  }

  private scaleMacrosToCalorieTarget(
    T: number,
    proteinG: number,
    carbsG: number,
    fatG: number,
  ): MacroBreakdown {
    const Tsafe = Math.max(1, T);
    let pc = proteinG * 4;
    let cc = carbsG * 4;
    let fc = fatG * 9;
    const sum = pc + cc + fc;
    if (sum <= 0) {
      return this.macroBreakdownFromTargetCalories(Tsafe);
    }
    const scale = Tsafe / sum;
    proteinG = Math.round(proteinG * scale * 10) / 10;
    carbsG = Math.round(carbsG * scale * 10) / 10;
    fatG = Math.round(fatG * scale * 10) / 10;
    pc = proteinG * 4;
    cc = carbsG * 4;
    fc = fatG * 9;
    const sum2 = pc + cc + fc;
    if (sum2 <= 0) {
      return this.macroBreakdownFromTargetCalories(Tsafe);
    }
    const scale2 = Tsafe / sum2;
    proteinG = Math.round(proteinG * scale2 * 10) / 10;
    carbsG = Math.round(carbsG * scale2 * 10) / 10;
    fatG = Math.round(fatG * scale2 * 10) / 10;
    pc = proteinG * 4;
    cc = carbsG * 4;
    fc = fatG * 9;
    return {
      proteinG,
      carbsG,
      fatG,
      proteinPercent: Math.round((pc * 100) / Tsafe),
      carbsPercent: Math.round((cc * 100) / Tsafe),
      fatPercent: Math.round((fc * 100) / Tsafe),
    };
  }

  computeNutritionPlan(input: NutritionPlanInput): NutritionPlanResult {
    const bmr = this.calculateBmr({
      gender: input.gender,
      age: input.age,
      heightCm: input.heightCm,
      currentWeightKg: input.currentWeightKg,
    });
    const tdee = this.calculateTdee(bmr, input.activityLevel);
    const targetCalories = this.resolveTargetCalories(tdee, input.goalType);
    const macros = this.macroBreakdownForGoal({
      ...input,
      targetCalories,
    });
    const previewThresholds = this.buildDefaultThresholds(
      0,
      targetCalories,
      macros,
      input.gender,
    ) as UserNutritionalThresholdEntity[];
    const macrosFromThresholds =
      this.macroBreakdownFromThresholds(targetCalories, previewThresholds) ??
      macros;
    return { bmr, tdee, targetCalories, ...macrosFromThresholds };
  }

  /**
   * Builds nutrient threshold rows aligned with goal-based macro centers (± band).
   */
  buildDefaultThresholds(
    userId: number,
    targetCalories: number,
    macroCenter: MacroBreakdown,
    gender?: string | null,
  ): Array<Partial<UserNutritionalThresholdEntity>> {
    const band = 0.12;
    const pc = macroCenter.proteinG;
    const cc = macroCenter.carbsG;
    const fc = macroCenter.fatG;

    const isFemale = String(gender || "").trim().toLowerCase() === "female";
    const vitAMin = isFemale ? 700 : 900;
    const vitCMin = isFemale ? 75 : 90;
    const vitKMin = isFemale ? 90 : 120;
    const vitB6Min = isFemale ? 1.3 : 1.7;
    const ironMin = isFemale ? 18 : 8;

    const rows: Array<Partial<UserNutritionalThresholdEntity>> = [
      {
        userId,
        nutrient: "calories",
        minAmount: targetCalories * 0.9,
        maxAmount: targetCalories * 1.1,
        unit: "kcal",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "protein",
        minAmount: Math.round(pc * (1 - band) * 10) / 10,
        maxAmount: Math.round(pc * (1 + band) * 10) / 10,
        unit: "g",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "carbs",
        minAmount: Math.round(cc * (1 - band) * 10) / 10,
        maxAmount: Math.round(cc * (1 + band) * 10) / 10,
        unit: "g",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "fat",
        minAmount: Math.round(fc * (1 - band) * 10) / 10,
        maxAmount: Math.round(fc * (1 + band) * 10) / 10,
        unit: "g",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "fiber",
        minAmount: this.defaultFiberMinGrams(targetCalories),
        maxAmount: null,
        unit: "g",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "sugars",
        minAmount: null,
        maxAmount: Math.round(((targetCalories * 0.1) / 4) * 10) / 10,
        unit: "g",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "sodium",
        minAmount: null,
        maxAmount: 2300,
        unit: "mg",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "saturatedFat",
        minAmount: null,
        maxAmount:
          Math.round(Math.min(20, (targetCalories * 0.1) / 9) * 10) / 10,
        unit: "g",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "cholesterol",
        minAmount: null,
        maxAmount: FDA_CHOLESTEROL_DAILY_VALUE_MG,
        unit: "mg",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "potassium",
        minAmount: FDA_POTASSIUM_DAILY_VALUE_MG,
        maxAmount: null,
        unit: "mg",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "calcium",
        minAmount: 1000,
        maxAmount: null,
        unit: "mg",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "iron",
        minAmount: ironMin,
        maxAmount: null,
        unit: "mg",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "magnesium",
        minAmount: 350,
        maxAmount: null,
        unit: "mg",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "phosphorus",
        minAmount: 700,
        maxAmount: null,
        unit: "mg",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "zinc",
        minAmount: 11,
        maxAmount: null,
        unit: "mg",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "vitaminA",
        minAmount: vitAMin,
        maxAmount: null,
        unit: "ug",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "vitaminC",
        minAmount: vitCMin,
        maxAmount: null,
        unit: "mg",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "vitaminD",
        minAmount: 15,
        maxAmount: null,
        unit: "ug",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "vitaminE",
        minAmount: 15,
        maxAmount: null,
        unit: "mg",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "vitaminK",
        minAmount: vitKMin,
        maxAmount: null,
        unit: "ug",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "vitaminB6",
        minAmount: vitB6Min,
        maxAmount: null,
        unit: "mg",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "vitaminB12",
        minAmount: 2.4,
        maxAmount: null,
        unit: "ug",
        isActive: true,
        origin: "system",
      },
      {
        userId,
        nutrient: "folateDfe",
        minAmount: 400,
        maxAmount: null,
        unit: "ug",
        isActive: true,
        origin: "system",
      },
    ];
    return rows;
  }

  /** USDA-style ~14 g fiber per 1000 kcal; clamp 15–38 g for low/high calorie targets. */
  defaultFiberMinGrams(targetCalories: number): number {
    const t = Math.max(1, Math.round(targetCalories));
    const raw = Math.round(((14 * t) / 1000) * 10) / 10;
    return Math.min(38, Math.max(15, raw));
  }

  calculateBmr(input: {
    gender: string | null;
    age: number | null;
    heightCm: number | null;
    currentWeightKg: number | null;
  }): number {
    const age = input.age || 0;
    const height = input.heightCm || 0;
    const weight = input.currentWeightKg || 0;
    const gender = (input.gender || "").toLowerCase();
    const base = 10 * weight + 6.25 * height - 5 * age;
    const bmr = gender === "male" ? base + 5 : base - 161;
    return Math.round(Math.max(800, bmr));
  }

  calculateTdee(bmr: number, activityLevel: string | null): number {
    const map: Record<string, number> = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9,
      beginner: 1.2,
      intermediate: 1.55,
      advanced: 1.725,
    };
    const multiplier = map[(activityLevel || "").toLowerCase()] || 1.2;
    return Math.round(bmr * multiplier);
  }

  macroBreakdownFromThresholds(
    targetCalories: number,
    thresholds: UserNutritionalThresholdEntity[],
  ): MacroBreakdown | null {
    const pick = (nutrient: string) =>
      thresholds.find((t) => t.nutrient === nutrient);
    const protein = pick("protein");
    const carbs = pick("carbs");
    const fat = pick("fat");
    if (!protein || !carbs || !fat) {
      return null;
    }
    const mid = (
      min: number | null | undefined,
      max: number | null | undefined,
    ) => {
      const a = min ?? 0;
      const b = max ?? a;
      return (a + b) / 2;
    };
    const proteinG =
      Math.round(mid(protein.minAmount, protein.maxAmount) * 10) / 10;
    const carbsG = Math.round(mid(carbs.minAmount, carbs.maxAmount) * 10) / 10;
    const fatG = Math.round(mid(fat.minAmount, fat.maxAmount) * 10) / 10;
    const proteinCals = proteinG * 4;
    const carbsCals = carbsG * 4;
    const fatCals = fatG * 9;
    const totalCals = proteinCals + carbsCals + fatCals;
    const T = totalCals > 0 ? totalCals : 1;
    return {
      proteinG,
      carbsG,
      fatG,
      proteinPercent: Math.round((proteinCals * 100) / T),
      carbsPercent: Math.round((carbsCals * 100) / T),
      fatPercent: Math.round((fatCals * 100) / T),
    };
  }
}
