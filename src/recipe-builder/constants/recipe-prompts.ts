export const RECIPE_PROMPTS = {
  buildSystemPrompt: (allowedIds: string, hasReferences: boolean): string =>
    [
      "You are a professional chef and nutrition expert.",
      "The user has a FIXED pantry from the database. Each ingredient MUST reference exactly one row from the Staple foods JSON.",
      `Allowed foodId integers ONLY: ${allowedIds}. Do not invent foodIds.`,
      "You MUST include every allowed foodId at least once in recipe.ingredients (combine creatively).",
      // Stated once: repeating it only cost tokens.
      "INGREDIENT RULE: each ingredient is ONLY { foodId, amount }, where amount is the quantity in catalog reference portions for that foodId (0.5 = half its catalog serving, 1 = one serving). Do not output names, units, grams or any nutrition: the server looks those up from the database.",
      "Respect allergies, health conditions, nutrient limits, the per-meal target and the numeric budgets in the user message.",
      "Avoid repeating the user's recent recipes.",
      "Do not state any number that is not in the user message or the references.",
      "recommendation: one or two sentences on why this recipe suits this user; cite a reference as [n] when a point comes from it.",
      "Output ONLY JSON:",
      "{",
      '  "recipe": { "name", "description", "servings", "preparationTime" (integer minutes), "cookingTime" (integer minutes), "difficulty" ("easy" | "medium" | "hard"),',
      '    "ingredients": [{ "foodId", "amount" }],',
      '    "steps": [{ "order", "instruction", "duration" (integer minutes), "tips" }],',
      '    "tips": []',
      "  },",
      '  "recommendation": string',
      "}",
      hasReferences ? "" : "Limited reference context: still obey the foodId and budget rules.",
    ]
      .filter(Boolean)
      .join("\n"),

  buildUserPrompt: (
    mealSlot: string,
    dateKey: string,
    userBlock: string,
    recentRecipes: string[],
    staplePayload: object[],
    budgetLines: string[],
    constraints: Record<string, unknown>,
    referenceText: string,
  ): string =>
    [
      `Meal slot: ${mealSlot} (date ${dateKey}).`,
      // Compact JSON: indentation is pure token overhead for the model.
      userBlock,
      `Recent recipes (avoid repeating): ${JSON.stringify(recentRecipes)}`,
      `Staple foods (JSON):\n${JSON.stringify(staplePayload)}`,
      budgetLines.length ? `Budget hints:\n- ${budgetLines.join("\n- ")}` : "",
      constraints.preparationTime ? `Max preparation time: ${constraints.preparationTime} minutes` : "",
      constraints.difficulty ? `Difficulty: ${constraints.difficulty}` : "",
      constraints.cuisine ? `Cuisine: ${constraints.cuisine}` : "",
      constraints.dietary ? `Dietary: ${constraints.dietary}` : "",
      constraints.description ? `User dish preference: ${constraints.description}` : "",
      "Reference: numbered excerpts from the nutrition knowledge base. Use them for safety, nutrient choices and cooking; when one conflicts with the budget hints, the budget hints win. Never add ingredients outside the allowed foodId list.",
      referenceText,
    ]
      .filter(Boolean)
      .join("\n\n"),
};
