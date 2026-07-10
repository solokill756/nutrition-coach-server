import { buildPersonalizedRagQuery } from "./personalized-rag-query";

describe("buildPersonalizedRagQuery", () => {
  const baseInput = {
    profile: {
      sex: "male" as const,
      dietType: null,
      allergies: [] as string[],
      fitnessLevel: "moderate",
    },
    goalTypes: ["weight_loss"],
    healthDetailed: [{ conditionName: "hypertension", severity: "mild" }],
    conditionRelatedThresholds: [
      { nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg" },
    ],
  };

  it("produces the same threshold phrase for recipe and dashboard purposes", () => {
    const recipe = buildPersonalizedRagQuery({ ...baseInput, purpose: "recipe_generation" });
    const dashboard = buildPersonalizedRagQuery({ ...baseInput, purpose: "dashboard_suggestion" });

    expect(recipe.question).toContain("sodium min 500 mg max 1500 mg");
    expect(dashboard.question).toContain("sodium min 500 mg max 1500 mg");
    expect(recipe.question).toContain("Condition-related nutrient limits");
    expect(dashboard.question).toContain("Condition-related nutrient limits");
  });

  it("adds purpose-specific keywords only", () => {
    const recipe = buildPersonalizedRagQuery({ ...baseInput, purpose: "recipe_generation" });
    const dashboard = buildPersonalizedRagQuery({ ...baseInput, purpose: "dashboard_suggestion" });

    expect(recipe.question).toContain("recipe");
    expect(dashboard.question).toContain("dashboard");
    expect(recipe.question).not.toContain("Daily dashboard nutrition suggestion");
  });

  it("uses condition_specific intent when health context exists", () => {
    const { hints } = buildPersonalizedRagQuery({ ...baseInput, purpose: "dashboard_suggestion" });
    expect(hints.intent).toBe("condition_specific");
    expect(hints.hasConditionContext).toBe(true);
  });
});
