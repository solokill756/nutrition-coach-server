import { allergyLabelToKey } from "../rag-ingest/rag-taxonomy";

export const ALLERGEN_KEYWORDS: Record<string, string[]> = {
  eggs: ["trứng", "egg", "eggs", "mayonnaise"],
  milk_lactose: ["sữa", "phô mai", "bơ sữa", "kem sữa", "milk", "cheese", "yogurt", "butter", "cream", "whey"],
  peanuts: ["đậu phộng", "lạc", "peanut", "peanuts"],
  tree_nuts: ["hạnh nhân", "óc chó", "hạt điều", "hạt dẻ", "hồ đào", "almond", "walnut", "cashew", "pecan", "hazelnut", "pistachio"],
  fish: ["cá", "fish", "salmon", "tuna", "cod", "nước mắm", "fish sauce"],
  shellfish: ["tôm", "cua", "ghẹ", "sò", "hàu", "nghêu", "mực", "shrimp", "prawn", "crab", "lobster", "oyster", "clam", "mussel", "squid"],
  soy: ["đậu nành", "đậu hũ", "đậu phụ", "tàu hũ", "nước tương", "xì dầu", "soy", "tofu", "edamame"],
  wheat_gluten: ["lúa mì", "bột mì", "mì", "bánh mì", "wheat", "flour", "bread", "pasta", "gluten"],
  sesame: ["mè", "vừng", "sesame", "tahini"],
};

function tokenize(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}

/** Returns the user's allergy labels (as given) that match the food name by whole-token keyword sequence. */
export function findAllergens(foodName: string, allergies: string[]): string[] {
  const nameTokens = tokenize(foodName);
  return allergies.filter((label) => {
    const key = allergyLabelToKey(label);
    const keywords = key && ALLERGEN_KEYWORDS[key] ? ALLERGEN_KEYWORDS[key] : [label.trim()];
    return keywords.some((keyword) => containsSequence(nameTokens, tokenize(keyword)));
  });
}
