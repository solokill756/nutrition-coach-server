import { sampleRecipeContext } from "../nutrition/__fixtures__/llm-context.fixture";
import { buildLlmUserProfile } from "../nutrition/llm-user-profile";
import {
  buildPersonalizedRagQuery,
  ragQueryInputFromContext,
  type PersonalizedRagQueryInput,
} from "./personalized-rag-query";

const hypertension: PersonalizedRagQueryInput = {
  purpose: "dashboard_suggestion",
  profile: { dietType: "balanced", allergies: [] },
  goalTypes: ["weight_loss"],
  healthDetailed: [{ conditionName: "hypertension" }],
  conditionRelatedThresholds: [{ nutrient: "sodium", minAmount: null, maxAmount: 1500, unit: "mg" }],
};

describe("buildPersonalizedRagQuery", () => {
  it("focuses the dashboard query on hypertension and sodium labels", () => {
    expect(buildPersonalizedRagQuery(hypertension)).toEqual({
      question: "Hypertension and sodium: read nutrition labels and choose lower-sodium foods.",
      hints: { intent: "condition_specific", hasConditionContext: true },
    });
  });

  it("keeps distinct conditions, allergies and relevant nutrients without duplicating them", () => {
    const { question, hints } = buildPersonalizedRagQuery({
      ...hypertension,
      profile: { dietType: "balanced", allergies: ["  Egg ", "egg", "shellfish"] },
      healthDetailed: [
        { conditionName: "hypertension" }, { conditionName: "Hypertension" }, { conditionName: "diabetes" },
      ],
      conditionRelatedThresholds: [
        ...hypertension.conditionRelatedThresholds,
        { nutrient: "saturatedFat", minAmount: null, maxAmount: 20, unit: "g" },
      ],
    });
    expect(question).toMatch(/food allergies: Egg, shellfish/i);
    expect(question).toContain("cross-contact");
    expect(question).toContain("diabetes plate method");
    expect(question).toContain("carbohydrate");
    expect(question).toContain("saturated fat");
    expect(question.match(/hypertension/gi)).toHaveLength(1);
    expect(question).not.toMatch(/1500|weight_loss|balanced/);
    expect(hints).toEqual({ intent: "safety", hasConditionContext: true });
  });

  it("preserves unknown health labels and normalized nutrient names", () => {
    const { question } = buildPersonalizedRagQuery({
      ...hypertension,
      healthDetailed: [{ conditionName: "custom_condition" }],
      conditionRelatedThresholds: [{ nutrient: "cholesterol", minAmount: null, maxAmount: 300, unit: "mg" }],
    });
    expect(question).toContain("custom condition");
    expect(question).toContain("cholesterol");
    expect(question).not.toContain("300");
  });

  it("keeps nutrient rules whose names overlap with a different search concept", () => {
    const { question } = buildPersonalizedRagQuery({
      ...hypertension,
      healthDetailed: [{ conditionName: "heart_disease" }, { conditionName: "diabetes" }],
      conditionRelatedThresholds: [
        { nutrient: "fat", minAmount: null, maxAmount: 50, unit: "g" },
        { nutrient: "sugars", minAmount: null, maxAmount: 25, unit: "g" },
      ],
    });
    expect(question).toContain("Food sources and choices for fat, sugar");
  });

  it("uses a relevant diet and goal when no safety or condition topic exists", () => {
    const { question, hints } = buildPersonalizedRagQuery({
      ...hypertension,
      profile: { dietType: "vegan" },
      goalTypes: ["weight_loss"],
      healthDetailed: [],
      conditionRelatedThresholds: [],
    });
    expect(question).toContain("vegan");
    expect(question).toContain("weight loss");
    expect(hints).toEqual({ intent: "general", hasConditionContext: false });
  });

  it("only includes a meal slot for a recipe request", () => {
    const ctx = sampleRecipeContext({ mealSlot: "dinner" });
    const recipe = buildPersonalizedRagQuery(ragQueryInputFromContext(ctx, "recipe_generation"));
    const dashboard = buildPersonalizedRagQuery(ragQueryInputFromContext(ctx, "dashboard_suggestion"));
    const allocation = buildPersonalizedRagQuery(ragQueryInputFromContext(ctx, "staple_allocation"));
    expect(recipe.question).toContain("dinner");
    expect(dashboard.question).not.toMatch(/dinner|breakfast/);
    expect(allocation.question).not.toMatch(/dinner|breakfast/);
    expect(allocation.question).toContain("ingredients");
  });

  it("keeps numeric limits and diary data in the generation prompt", () => {
    const ctx = sampleRecipeContext();
    const { question } = buildPersonalizedRagQuery(ragQueryInputFromContext(ctx, "dashboard_suggestion"));
    const generation = buildLlmUserProfile(ctx);
    expect(question).not.toMatch(/2000|850|1149|kg|UserGoal|AppUser/);
    expect(generation.nutrientLimits).toContain("sodium max 2000 mg");
    expect(generation.today.intake.totalSodium).toBe(850.3);
    expect(generation.today.remaining.sodiumMg).toBe(1149.8);
  });
});
