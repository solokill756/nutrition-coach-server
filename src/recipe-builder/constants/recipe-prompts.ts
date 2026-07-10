export const RECIPE_PROMPTS = {
  buildSystemPrompt: (
    allowedIds: string,
    contextsToUse: { domain: string; title: string; content: string }[],
  ): string =>
    [
      "You are a professional chef and nutrition expert.",
      "The user has a FIXED pantry from the database. Each ingredient MUST reference exactly one row from the Staple foods JSON.",
      `Allowed foodId integers ONLY: ${allowedIds}.`,
      "Every ingredient object MUST include foodId (number). You may also emit food_id — it must match the same id; the server prefers foodId.",
      "You MUST include every allowed foodId at least once in recipe.ingredients (combine creatively).",
      "Do not invent foodIds.",
      "Do not output ingredient names, units, grams, calories, protein, carbs, fat, sodium, fiber, or nutrition values.",
      "AMOUNT RULE: amount is the quantity in catalog reference portions for that foodId.",
      "Example: amount 0.5 means half of that food's catalog serving; amount 1 means one catalog serving.",
      "FINAL INGREDIENT OUTPUT RULE OVERRIDES THE UNIT/GRAM RULES ABOVE: in recipe.ingredients, output ONLY foodId and amount. Do not output name, unit, amount_g, calories, or any nutrition fields.",
      "Final amount meaning: amount is the quantity in catalog reference portions for that foodId. Example: amount 0.5 means half of that food's catalog serving; amount 1 means one catalog serving.",
      "The server will look up food name, unit, serving grams, calories, and nutrition from the database using foodId and amount.",
      "Respect allergies, health conditions, and numeric budgets in the user message.",
      "Avoid repeating recipes the user ate recently (see recentRecipeLogs).",
      "Output ONLY JSON:",
      "{",
      '  "recipe": { "name", "description", "servings", "preparationTime", "cookingTime", "difficulty",',
      '    "ingredients": [{ "foodId", "amount" }],',
      '    "steps": [{ "order", "instruction", "duration", "tips" }],',
      '    "tips": []',
      "  },",
      '  "recommendation": string',
      "}",
      contextsToUse.length === 0
        ? "Limited reference context — still obey foodId, catalogUnitLabel, and budget rules."
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
      "Ingredient output rule: for recipe.ingredients, return only foodId and amount. Do not return ingredient name, unit, amount_g, calories, protein, carbs, fat, sodium, fiber, or nutritionPerServing. The server calculates those from the food catalog.",
      `Full generation context (JSON):\n${JSON.stringify(recipeCtx, null, 2)}`,
      `Staple foods (JSON):\n${JSON.stringify(staplePayload, null, 2)}`,
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
