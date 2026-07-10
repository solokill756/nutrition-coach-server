import type { RecipeGenerationContext } from "../nutrition/user-context.service";
import { buildPersonalizedRagQuery } from "../retrieval/personalized-rag-query";
import type { RetrievalHints } from "../retrieval/retrieval.types";

/**
 * Recipe Builder RAG query — delegates to {@link buildPersonalizedRagQuery}.
 */
export function buildRecipeGenerationRagQuery(ctx: RecipeGenerationContext): {
  question: string;
  hints: RetrievalHints;
} {
  return buildPersonalizedRagQuery({
    purpose: "recipe_generation",
    profile: {
      sex: ctx.profile.sex,
      dietType: ctx.profile.dietType,
      allergies: ctx.profile.allergies,
      fitnessLevel: ctx.profile.fitnessLevel,
    },
    goalTypes: ctx.goalsDetailed.map((g) => g.goalType),
    healthDetailed: ctx.healthDetailed,
    conditionRelatedThresholds: ctx.conditionRelatedThresholds ?? [],
  });
}
