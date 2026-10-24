import type { RecipeGenerationContext } from "../nutrition/user-context.service";
import {
  buildPersonalizedRagQuery,
  ragQueryInputFromContext,
} from "../retrieval/personalized-rag-query";
import type { RetrievalHints } from "../retrieval/retrieval.types";

/**
 * Recipe Builder RAG query — delegates to {@link buildPersonalizedRagQuery}
 * through the shared context mapping.
 */
export function buildRecipeGenerationRagQuery(ctx: RecipeGenerationContext): {
  question: string;
  hints: RetrievalHints;
} {
  return buildPersonalizedRagQuery(ragQueryInputFromContext(ctx, "recipe_generation"));
}
