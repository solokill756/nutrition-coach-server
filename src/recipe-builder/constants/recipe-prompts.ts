export const RECIPE_PROMPTS = {
  buildSystemPrompt: (
    allowedIds: string,
    contextsToUse: { domain: string; title: string; content: string }[],
  ): string =>
    [
      "You are a professional chef and nutrition expert.",
      "The user has a FIXED pantry from the database. Each ingredient MUST reference exactly one row from the Staple foods JSON.",
      `Allowed foodId integers ONLY: ${allowedIds}. Do not invent foodIds.`,
      "You MUST include every allowed foodId at least once in recipe.ingredients (combine creatively).",
      // Stated once: repeating it only cost tokens.
      "INGREDIENT RULE: each ingredient is ONLY { foodId, amount }, where amount is the quantity in catalog reference portions for that foodId (0.5 = half its catalog serving, 1 = one serving). Do not output names, units, grams or any nutrition: the server looks those up from the database.",
      "Respect allergies, health conditions, the per-meal target and the numeric budgets in the user message.",
      "Avoid repeating recipes the user ate recently (see recentRecipeLogs).",
      "Output ONLY JSON:",
      "{",
      '  "recipe": { "name", "description", "servings", "preparationTime", "cookingTime", "difficulty" ("easy" | "medium" | "hard"),',
      '    "ingredients": [{ "foodId", "amount" }],',
      '    "steps": [{ "order", "instruction", "duration", "tips" }],',
      '    "tips": []',
      "  },",
      '  "recommendation": string',
      "}",
      contextsToUse.length === 0
        ? "Limited reference context: still obey the foodId and budget rules."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),

  buildUserPrompt: (
    mealSlot: string,
    dateKey: string,
    recipeCtx: object,
    staplePayload: object[],
    budgetLines: string[],
    constraints: Record<string, unknown>,
    contextText: string,
    contextsToUse: { domain: string; title: string; content: string }[],
  ): string =>
    [
      `Meal slot: ${mealSlot} (date ${dateKey}).`,
      "RAG: The 'Reference' section below comes from RetrievalService (hybrid retrieval over the nutrition corpus). Use it only for cooking and safety guidance; do not introduce ingredients outside the allowed foodId list.",
      // Compact JSON: indentation is pure token overhead for the model.
      `Full generation context (JSON):\n${JSON.stringify(recipeCtx)}`,
      `Staple foods (JSON):\n${JSON.stringify(staplePayload)}`,
      budgetLines.length ? `Budget hints:\n- ${budgetLines.join("\n- ")}` : "",
      constraints.preparationTime ? `Max preparation time: ${constraints.preparationTime} minutes` : "",
      constraints.difficulty ? `Difficulty: ${constraints.difficulty}` : "",
      constraints.cuisine ? `Cuisine: ${constraints.cuisine}` : "",
      constraints.dietary ? `Dietary: ${constraints.dietary}` : "",
      constraints.description ? `User dish preference: ${constraints.description}` : "",
      "Reference (guidelines only; do not add ingredients not in allowed foodId list):",
      contextsToUse.length > 0 ? contextText : "None.",
    ]
      .filter(Boolean)
      .join("\n\n"),
};
