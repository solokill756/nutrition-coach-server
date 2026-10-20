// Fixed tag taxonomy for the RAG knowledge base.
//
// Sources:
// - conditions, goals and allergens follow calorie-counter-web/src/features/onboarding/mapping.ts
//   (conditionOptions, goalOptions, allergyOptions). They have NOT been cross-checked against the Flutter app.
// - nutrients: the 9 required keys plus keys the backend actually tracks, taken from
//   src/nutrition/condition-nutrient-unit.service.ts (macro / mg nutrient sets, "calories" -> kcal),
//   src/nutrition/entities/user-nutritional-threshold.entity.ts (Nutrient column: "sodium, carbs, protein, etc.")
//   and src/nutrition/condition-nutrient-rule-applier.service.ts (macro rebalance over protein/carbs/fat).
//   Keys here are snake_case; the backend normalizes nutrient names by stripping "_" / "-" and lowercasing
//   (e.g. "saturated_fat" -> "saturatedfat", "sugar" is "sugars" there).

export type RagTagGroup = "conditions" | "allergens" | "goals" | "nutrients";
export type RagDomain = "guidelines" | "conditions" | "safety";
export type RagTags = Record<RagTagGroup, string[]>;
export type RagTaxonomyItem = { key: string; labelEn: string; labelVi: string; description: string };

const TAG_GROUPS: RagTagGroup[] = ["conditions", "allergens", "goals", "nutrients"];

export const RAG_DOMAINS: RagTaxonomyItem[] = [
  {
    key: "guidelines",
    labelEn: "Guidelines",
    labelVi: "Hướng dẫn dinh dưỡng chung",
    description: "Does this passage give general nutrition or healthy eating guidelines, such as recommended intakes or dietary patterns?",
  },
  {
    key: "conditions",
    labelEn: "Health conditions",
    labelVi: "Bệnh lý",
    description: "Does this passage discuss diet or nutrition management for a specific health condition or disease?",
  },
  {
    key: "safety",
    labelEn: "Safety",
    labelVi: "An toàn",
    description: "Does this passage cover food safety, allergies, contraindications or warnings about risky eating practices?",
  },
];

export const RAG_TAXONOMY: Record<RagTagGroup, RagTaxonomyItem[]> = {
  conditions: [
    {
      key: "hypertension",
      labelEn: "High blood pressure",
      labelVi: "Tăng huyết áp",
      description: "Does this passage give dietary advice relevant to people with high blood pressure (hypertension)?",
    },
    {
      key: "diabetes",
      labelEn: "Diabetes",
      labelVi: "Tiểu đường",
      description: "Does this passage give dietary advice relevant to people with diabetes or blood sugar control?",
    },
    {
      key: "heart_disease",
      labelEn: "Heart disease",
      labelVi: "Bệnh tim mạch",
      description: "Does this passage give dietary advice relevant to people with heart disease or cardiovascular risk?",
    },
    {
      key: "kidney_disease",
      labelEn: "Kidney disease",
      labelVi: "Bệnh thận",
      description: "Does this passage give dietary advice relevant to people with kidney disease?",
    },
    {
      key: "thyroid",
      labelEn: "Thyroid disorder",
      labelVi: "Rối loạn tuyến giáp",
      description: "Does this passage give dietary advice relevant to people with a thyroid disorder?",
    },
    {
      key: "high_cholesterol",
      labelEn: "High cholesterol",
      labelVi: "Mỡ máu cao",
      description: "Does this passage give dietary advice relevant to people with high cholesterol?",
    },
  ],
  allergens: [
    {
      key: "peanuts",
      labelEn: "Peanuts",
      labelVi: "Đậu phộng",
      description: "Does this passage mention or warn about a peanut allergy or foods containing peanuts?",
    },
    {
      key: "tree_nuts",
      labelEn: "Tree nuts",
      labelVi: "Các loại hạt cây",
      description: "Does this passage mention or warn about a tree nut allergy or foods containing tree nuts such as almonds, walnuts or cashews?",
    },
    {
      key: "milk_lactose",
      labelEn: "Milk or lactose",
      labelVi: "Sữa hoặc lactose",
      description: "Does this passage mention or warn about a milk allergy, lactose intolerance or foods containing dairy?",
    },
    {
      key: "eggs",
      labelEn: "Eggs",
      labelVi: "Trứng",
      description: "Does this passage mention or warn about an egg allergy or foods containing eggs?",
    },
    {
      key: "fish",
      labelEn: "Fish",
      labelVi: "Cá",
      description: "Does this passage mention or warn about a fish allergy or foods containing fish?",
    },
    {
      key: "shellfish",
      labelEn: "Shellfish",
      labelVi: "Hải sản có vỏ",
      description: "Does this passage mention or warn about a shellfish allergy or foods containing shrimp, crab or other shellfish?",
    },
    {
      key: "soy",
      labelEn: "Soy",
      labelVi: "Đậu nành",
      description: "Does this passage mention or warn about a soy allergy or foods containing soy?",
    },
    {
      key: "wheat_gluten",
      labelEn: "Wheat or gluten",
      labelVi: "Lúa mì hoặc gluten",
      description: "Does this passage mention or warn about a wheat allergy, gluten intolerance or celiac disease, or foods containing gluten?",
    },
    {
      key: "sesame",
      labelEn: "Sesame",
      labelVi: "Mè (vừng)",
      description: "Does this passage mention or warn about a sesame allergy or foods containing sesame?",
    },
  ],
  goals: [
    {
      key: "weight_loss",
      labelEn: "Lose weight",
      labelVi: "Giảm cân",
      description: "Does this passage give advice on losing weight, such as a calorie deficit or fat loss?",
    },
    {
      key: "maintenance",
      labelEn: "Maintain weight",
      labelVi: "Giữ cân",
      description: "Does this passage give advice on maintaining a stable body weight?",
    },
    {
      key: "weight_gain",
      labelEn: "Gain weight",
      labelVi: "Tăng cân",
      description: "Does this passage give advice on gaining weight, such as a calorie surplus?",
    },
    {
      key: "muscle_gain",
      labelEn: "Build muscle",
      labelVi: "Tăng cơ",
      description: "Does this passage give advice on building muscle, such as protein intake and training nutrition?",
    },
    {
      key: "modify_diet",
      labelEn: "Eat healthier",
      labelVi: "Ăn uống lành mạnh hơn",
      description: "Does this passage give advice on improving overall diet quality or eating healthier?",
    },
    {
      key: "plan_meals",
      labelEn: "Plan meals",
      labelVi: "Lên kế hoạch bữa ăn",
      description: "Does this passage give advice on planning, preparing or organising meals ahead of time?",
    },
    {
      key: "manage_stress",
      labelEn: "Manage stress",
      labelVi: "Giảm căng thẳng",
      description: "Does this passage connect eating habits or nutrition with managing stress or mood?",
    },
    {
      key: "stay_active",
      labelEn: "Stay active",
      labelVi: "Duy trì vận động",
      description: "Does this passage give advice on fuelling physical activity or an active lifestyle?",
    },
  ],
  nutrients: [
    {
      key: "sodium",
      labelEn: "Sodium",
      labelVi: "Natri",
      description: "Does this passage discuss sodium or salt intake, limits or sources?",
    },
    {
      key: "sugar",
      labelEn: "Sugar",
      labelVi: "Đường",
      description: "Does this passage discuss sugar intake, added sugars, limits or sources?",
    },
    {
      key: "fiber",
      labelEn: "Fiber",
      labelVi: "Chất xơ",
      description: "Does this passage discuss dietary fiber intake or sources?",
    },
    {
      key: "saturated_fat",
      labelEn: "Saturated fat",
      labelVi: "Chất béo bão hòa",
      description: "Does this passage discuss saturated fat intake, limits or sources?",
    },
    {
      key: "cholesterol",
      labelEn: "Cholesterol",
      labelVi: "Cholesterol",
      description: "Does this passage discuss dietary cholesterol intake or sources?",
    },
    {
      key: "potassium",
      labelEn: "Potassium",
      labelVi: "Kali",
      description: "Does this passage discuss potassium intake, limits or sources?",
    },
    {
      key: "protein",
      labelEn: "Protein",
      labelVi: "Chất đạm",
      description: "Does this passage discuss protein intake, requirements or sources?",
    },
    {
      key: "carbs",
      labelEn: "Carbohydrates",
      labelVi: "Tinh bột (carbohydrate)",
      description: "Does this passage discuss carbohydrate intake, quality or sources?",
    },
    {
      key: "calories",
      labelEn: "Calories",
      labelVi: "Calo",
      description: "Does this passage discuss calorie or energy intake, needs or targets?",
    },
    {
      key: "fat",
      labelEn: "Total fat",
      labelVi: "Chất béo",
      description: "Does this passage discuss total fat intake, types of fat or sources?",
    },
    {
      key: "phosphorus",
      labelEn: "Phosphorus",
      labelVi: "Phốt pho",
      description: "Does this passage discuss phosphorus intake, limits or sources?",
    },
    {
      key: "calcium",
      labelEn: "Calcium",
      labelVi: "Canxi",
      description: "Does this passage discuss calcium intake or sources?",
    },
    {
      key: "iron",
      labelEn: "Iron",
      labelVi: "Sắt",
      description: "Does this passage discuss iron intake or sources?",
    },
    {
      key: "magnesium",
      labelEn: "Magnesium",
      labelVi: "Magiê",
      description: "Does this passage discuss magnesium intake or sources?",
    },
    {
      key: "zinc",
      labelEn: "Zinc",
      labelVi: "Kẽm",
      description: "Does this passage discuss zinc intake or sources?",
    },
  ],
};

// Onboarding allergy labels (allergyOptions in mapping.ts) -> allergen keys.
const ALLERGY_LABEL_TO_KEY: Record<string, string> = {
  peanuts: "peanuts",
  "tree nuts": "tree_nuts",
  "milk or lactose": "milk_lactose",
  eggs: "eggs",
  fish: "fish",
  shellfish: "shellfish",
  soy: "soy",
  "wheat or gluten": "wheat_gluten",
  sesame: "sesame",
};

export function emptyTags(): RagTags {
  return { conditions: [], allergens: [], goals: [], nutrients: [] };
}

export function sanitizeTags(input: unknown): { tags: RagTags; invalid: string[] } {
  const tags = emptyTags();
  const invalid: string[] = [];
  const source: Record<string, unknown> = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};

  for (const group of TAG_GROUPS) {
    const raw = source[group];
    const values: unknown[] = Array.isArray(raw) ? raw : [];
    const seen = new Set<string>();
    const known = new Set(RAG_TAXONOMY[group].map((item) => item.key));

    for (const value of values) {
      if (typeof value === "string" && known.has(value)) {
        seen.add(value);
      } else {
        const label = `${group}:${String(value)}`;
        if (!invalid.includes(label)) invalid.push(label);
      }
    }
    tags[group] = RAG_TAXONOMY[group].map((item) => item.key).filter((key) => seen.has(key));
  }

  return { tags, invalid };
}

export function isRagDomain(value: unknown): value is RagDomain {
  return typeof value === "string" && RAG_DOMAINS.some((domain) => domain.key === value);
}

export function allergyLabelToKey(label: string): string | null {
  return ALLERGY_LABEL_TO_KEY[label.trim().toLowerCase()] ?? null;
}
