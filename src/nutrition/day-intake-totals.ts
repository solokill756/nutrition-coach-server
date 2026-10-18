import type { LogFoodEntity } from "./entities/log-food.entity";

export type DayIntakeTotals = {
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  totalSodium: number;
  totalSugar: number;
  totalSaturatedFat: number;
  totalCholesterol: number;
  totalPotassium: number;
  totalFiber: number;
  totalPhosphorus: number;
};

/** Sums LogFood snapshot rows (numeric columns are strings); null or empty counts as 0. */
export function sumDayIntake(
  rows: Array<
    Pick<
      LogFoodEntity,
      | "calories"
      | "proteinG"
      | "totalCarbohydratesG"
      | "totalFatG"
      | "sodiumMg"
      | "sugarsG"
      | "saturatedFatG"
      | "cholesterolMg"
      | "potassiumMg"
      | "dietaryFibersG"
      | "phosphorusMg"
    >
  >,
): DayIntakeTotals {
  const t: DayIntakeTotals = {
    totalCalories: 0,
    totalProtein: 0,
    totalCarbs: 0,
    totalFat: 0,
    totalSodium: 0,
    totalSugar: 0,
    totalSaturatedFat: 0,
    totalCholesterol: 0,
    totalPotassium: 0,
    totalFiber: 0,
    totalPhosphorus: 0,
  };
  for (const r of rows) {
    t.totalCalories += Number(r.calories) || 0;
    t.totalProtein += Number(r.proteinG) || 0;
    t.totalCarbs += Number(r.totalCarbohydratesG) || 0;
    t.totalFat += Number(r.totalFatG) || 0;
    t.totalSodium += Number(r.sodiumMg) || 0;
    t.totalSugar += Number(r.sugarsG) || 0;
    t.totalSaturatedFat += Number(r.saturatedFatG) || 0;
    t.totalCholesterol += Number(r.cholesterolMg) || 0;
    t.totalPotassium += Number(r.potassiumMg) || 0;
    t.totalFiber += Number(r.dietaryFibersG) || 0;
    t.totalPhosphorus += Number(r.phosphorusMg) || 0;
  }
  return t;
}
