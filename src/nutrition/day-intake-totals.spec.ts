import { sumDayIntake } from "./day-intake-totals";

describe("sumDayIntake", () => {
  it("sums snapshot strings and treats null or empty as 0", () => {
    const out = sumDayIntake([
      { calories: "300", proteinG: "20", totalCarbohydratesG: "30", totalFatG: "10", sodiumMg: "400",
        sugarsG: "4", saturatedFatG: "2", cholesterolMg: "50", potassiumMg: "300", dietaryFibersG: "5", phosphorusMg: "200" },
      { calories: "500", proteinG: null, totalCarbohydratesG: "", totalFatG: "5", sodiumMg: null,
        sugarsG: "6", saturatedFatG: null, cholesterolMg: null, potassiumMg: null, dietaryFibersG: null, phosphorusMg: null },
    ] as any);
    expect(out).toEqual({
      totalCalories: 800, totalProtein: 20, totalCarbs: 30, totalFat: 15, totalSodium: 400, totalSugar: 10,
      totalSaturatedFat: 2, totalCholesterol: 50, totalPotassium: 300, totalFiber: 5, totalPhosphorus: 200,
    });
  });

  it("returns zeros for no rows", () => {
    expect(Object.values(sumDayIntake([]))).toEqual(Array(11).fill(0));
  });
});
