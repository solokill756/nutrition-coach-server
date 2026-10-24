import { allergyLabelToKey } from "../rag-ingest/rag-taxonomy";

export const ALLERGEN_KEYWORDS: Record<string, string[]> = {
  eggs: ["trứng", "egg", "eggs", "mayonnaise"],
  milk_lactose: ["sữa", "phô mai", "bơ sữa", "kem sữa", "milk", "cheese", "yogurt", "butter", "cream", "ice cream", "whey", "lactose", "buttermilk", "ghee", "casein", "kem"],
  peanuts: ["đậu phộng", "lạc", "peanut", "peanuts"],
  tree_nuts: ["hạnh nhân", "óc chó", "hạt điều", "hạt dẻ", "hồ đào", "almond", "walnut", "cashew", "pecan", "hazelnut", "pistachio", "nut", "macadamia", "brazil", "hạt mắc ca"],
  fish: ["cá", "fish", "salmon", "tuna", "cod", "nước mắm", "fish sauce", "sardine", "mackerel", "anchovy", "tilapia", "catfish", "trout"],
  shellfish: ["tôm", "cua", "ghẹ", "sò", "hàu", "nghêu", "mực", "shrimp", "prawn", "crab", "lobster", "oyster", "clam", "mussel", "squid", "scallop", "mollusk", "crustacean", "crayfish"],
  soy: ["đậu nành", "đậu hũ", "đậu phụ", "tàu hũ", "nước tương", "xì dầu", "soy", "soybean", "tofu", "edamame", "soymilk", "miso", "tempeh"],
  wheat_gluten: ["lúa mì", "bột mì", "mì", "bánh mì", "wheat", "flour", "bread", "pasta", "gluten", "barley", "rye", "spaghetti", "macaroni", "noodle", "couscous", "cracker"],
  sesame: ["mè", "vừng", "sesame", "tahini"],
};

function tokenize(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function tokenMatches(foodToken: string, keywordToken: string, allowPlural: boolean): boolean {
  if (foodToken === keywordToken) return true;
  return allowPlural && (foodToken === keywordToken + "s" || foodToken === keywordToken + "es");
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  // English plural tolerance only for single-token ASCII-letter keywords.
  const allowPlural = needle.length === 1 && /^[a-z]+$/.test(needle[0]);
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((token, j) => tokenMatches(haystack[i + j], token, allowPlural))) return true;
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
