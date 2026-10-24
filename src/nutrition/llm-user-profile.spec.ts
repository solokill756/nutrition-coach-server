import { buildLlmUserProfile, formatLlmUserBlock } from "./llm-user-profile";
import { sampleRecipeContext } from "./__fixtures__/llm-context.fixture";

describe("llm-user-profile", () => {
  it("maps profile fields", () => {
    const p = buildLlmUserProfile(sampleRecipeContext());
    expect(p.age).toBe(34);
    expect(p.allergies).toEqual(["Eggs"]);
    expect(p.goals).toEqual(["lose_weight", "low_sodium"]);
    expect(p.healthConditions).toEqual(["hypertension"]);
  });

  it("dedupes nutrient limits", () => {
    const p = buildLlmUserProfile(sampleRecipeContext());
    expect(p.nutrientLimits.filter((s) => s.startsWith("sodium"))).toHaveLength(1);
    expect(p.nutrientLimits.filter((s) => s.startsWith("potassium"))).toHaveLength(1);
    expect(p.nutrientLimits).toHaveLength(2);
  });

  it("today excludes calories", () => {
    const p = buildLlmUserProfile(sampleRecipeContext());
    expect(p.today.intake).not.toHaveProperty("totalCalories");
    expect(p.today.remaining).not.toHaveProperty("calories");
  });

  it("today drops nulls and rounds to 1 decimal", () => {
    const p = buildLlmUserProfile(sampleRecipeContext());
    expect(p.today.remaining.sodiumMg).toBe(1149.8);
    expect(p.today.remaining).not.toHaveProperty("carbsG");
    expect(p.today.intake.totalSodium).toBe(850.3);
  });

  it("format is compact", () => {
    const p = buildLlmUserProfile(sampleRecipeContext());
    expect(formatLlmUserBlock(p)).toBe("User (JSON):\n" + JSON.stringify(p));
  });
});
