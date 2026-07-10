export const FOOD_PROMPTS = {
  /** AI estimate nutritional values for a food when not found in DB */
  NUTRITION_ESTIMATION: (name: string): string =>
    `Estimate typical nutritional values for 100g of "${name}". \
Return ONLY a JSON object with keys: calories, protein, carbs, fat, sodium (mg). \
Be conservative and realistic. Format: {"calories": X, "protein": X, "carbs": X, "fat": X, "sodium": X}`,

  /** Translate food name to professional English for DB lookup (LLM fallback) */
  TRANSLATION: (text: string): string =>
    `Translate this food name to a concise, professional English food name for nutritional database lookup. \
Only return the translated name, no explanation. \
Food: "${text}"`,
};
