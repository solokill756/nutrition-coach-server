import type { RecipeGenerationContext } from "../nutrition/user-context.service";
import { buildRecipeGenerationRagQuery } from "./recipe-rag-query";

function baseCtx(overrides: Partial<RecipeGenerationContext> = {}): RecipeGenerationContext {
  return {
    userId: 1,
    dateKey: "2026-06-14",
    mealSlot: "lunch",
    recentLogHistoryDays: 3,
    profile: {
      age: 30,
      sex: "male",
      weight: 70,
      goalWeight: 68,
      height: 170,
      dietType: null,
      allergies: [],
      fitnessLevel: "moderate",
    },
    goalsDetailed: [{ id: 1, goalType: "weight_loss", targetCalories: 2000, startDate: new Date(), endDate: null }],
    healthDetailed: [{ conditionName: "hypertension", severity: "mild" }],
    thresholds: [
      { nutrient: "protein", minAmount: 80, maxAmount: 120, unit: "g" },
      { nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg" },
    ],
    conditionRelatedThresholds: [
      { nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg" },
    ],
    recentHistory: [],
    recentRecipeLogs: [],
    todayIntake: {
      totalCalories: 0,
      totalProtein: 0,
      totalCarbs: 0,
      totalFat: 0,
      totalSodium: 0,
      totalSugar: 0,
      totalSaturatedFat: 0,
      totalCholesterol: 0,
      totalPotassium: 0,
    },
    dailyTargetCalories: 2000,
    remaining: {
      calories: 2000,
      sodiumMg: 1500,
      carbsG: null,
      proteinG: null,
      fatG: null,
      sugarG: null,
      saturatedFatG: null,
      cholesterolMg: null,
      potassiumMgMinRemaining: null,
    },
    ...overrides,
  };
}

describe("buildRecipeGenerationRagQuery", () => {
  it("includes condition-related min/max in the query, not all thresholds", () => {
    const { question } = buildRecipeGenerationRagQuery(baseCtx());

    expect(question).toContain("Condition-related nutrient limits");
    expect(question).toContain("sodium min 500 mg max 1500 mg");
    expect(question).not.toContain("protein min 80");
    expect(question).not.toContain("protein max 120");
  });

  it("omits threshold section when no condition-related nutrients", () => {
    const { question, hints } = buildRecipeGenerationRagQuery(
      baseCtx({ conditionRelatedThresholds: [], healthDetailed: [] }),
    );

    expect(question).not.toContain("Condition-related nutrient limits");
    expect(hints.intent).toBe("food_specific");
  });

  it("uses safety intent when allergies present", () => {
    const { hints } = buildRecipeGenerationRagQuery(
      baseCtx({ profile: { ...baseCtx().profile, allergies: ["peanut"] } }),
    );
    expect(hints.intent).toBe("safety");
  });
});
