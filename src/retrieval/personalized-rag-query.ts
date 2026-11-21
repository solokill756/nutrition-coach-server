import type { RecipeGenerationContext, UserNutrientThreshold } from "../nutrition/user-context.service";
import type { RetrievalHints } from "./retrieval.types";

const MAX_QUERY_CHARS = 2800;

type ConditionTopic = { text: string; nutrients?: string[] };

const CONDITION_TOPICS: Record<string, ConditionTopic> = {
  hypertension: {
    text: "Hypertension and sodium: read nutrition labels and choose lower-sodium foods",
    nutrients: ["sodium"],
  },
  "high blood pressure": {
    text: "High blood pressure and sodium: read nutrition labels and choose lower-sodium foods",
    nutrients: ["sodium"],
  },
  diabetes: {
    text: "Diabetes meal planning: diabetes plate method, carbohydrate counting and high-fiber foods to manage blood sugar",
    nutrients: ["carbohydrates", "fiber"],
  },
  "type 1 diabetes": {
    text: "Type 1 diabetes: carbohydrate portions and food labels for blood glucose management",
    nutrients: ["carbohydrates"],
  },
  "type 2 diabetes": {
    text: "Type 2 diabetes meal planning: diabetes plate method, carbohydrate counting and high-fiber foods",
    nutrients: ["carbohydrates", "fiber"],
  },
  prediabetes: {
    text: "Prediabetes: carbohydrate portions and high-fiber foods for blood glucose management",
    nutrients: ["carbohydrates", "fiber"],
  },
  "pre diabetes": {
    text: "Prediabetes: carbohydrate portions and high-fiber foods for blood glucose management",
    nutrients: ["carbohydrates", "fiber"],
  },
  "kidney disease": {
    text: "Kidney disease: food choices and nutrition for chronic kidney disease",
  },
  "heart disease": {
    text: "Heart disease: choose heart-healthy foods and limit saturated fat",
    nutrients: ["saturated fat"],
  },
  "high cholesterol": {
    text: "High cholesterol: choose foods lower in saturated fat and higher in fiber",
    nutrients: ["saturated fat", "fiber"],
  },
  thyroid: {
    text: "Thyroid disorders: nutrition and food choices",
  },
};

const NUTRIENT_LABELS: Record<string, string> = {
  carbs: "carbohydrates",
  saturatedfat: "saturated fat",
  sugars: "sugar",
};

const GOAL_TOPICS: Record<string, string> = {
  "weight loss": "healthy food choices for weight loss",
  "lose weight": "healthy food choices for weight loss",
  "weight gain": "nutrient-dense foods for weight gain",
  "muscle gain": "protein-rich foods for muscle gain",
  "plan meals": "meal planning",
};

const DIET_STYLES = new Set([
  "dairy free", "gluten free", "halal", "keto", "kosher", "low carb",
  "low sodium", "mediterranean", "pescatarian", "vegan", "vegetarian",
]);

export type PersonalizedRagHealthCondition = {
  conditionName: string;
};

export type PersonalizedRagQueryInput = {
  purpose: "recipe_generation" | "dashboard_suggestion" | "staple_allocation";
  mealSlot?: RecipeGenerationContext["mealSlot"];
  profile: {
    dietType?: string | null;
    allergies?: string[];
  };
  goalTypes: string[];
  healthDetailed: PersonalizedRagHealthCondition[];
  conditionRelatedThresholds: UserNutrientThreshold[];
};

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function key(value: string): string {
  return label(value.replace(/-/g, " ")).toLowerCase();
}

function uniqueLabels(values: string[]): string[] {
  const entries = new Map<string, string>();
  for (const raw of values) {
    const text = label(raw);
    const normalized = key(text);
    if (normalized && !entries.has(normalized)) entries.set(normalized, text);
  }
  return [...entries.values()];
}

function topicFor<T>(topics: Record<string, T>, name: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(topics, name) ? topics[name] : undefined;
}

function nutrientLabel(nutrient: string): string {
  const normalized = key(nutrient);
  return topicFor(NUTRIENT_LABELS, normalized.replace(/ /g, "")) ?? normalized;
}

/** Build search topics. Numeric limits and daily intake belong in the generation prompt. */
export function buildPersonalizedRagQuery(input: PersonalizedRagQueryInput): {
  question: string;
  hints: RetrievalHints;
} {
  const allergies = uniqueLabels(input.profile.allergies ?? []);
  const conditions = uniqueLabels(input.healthDetailed.map((condition) => condition.conditionName))
    .sort((a, b) => key(a).localeCompare(key(b)));
  const conditionTopics = conditions.map((condition): ConditionTopic =>
    topicFor(CONDITION_TOPICS, key(condition)) ?? { text: `${condition}: nutrition and food choices` },
  );
  const coveredNutrients = new Set(conditionTopics.flatMap((topic) => topic.nutrients ?? []));
  const nutrients = uniqueLabels((input.conditionRelatedThresholds ?? []).map(({ nutrient }) => nutrientLabel(nutrient)))
    .filter((name) => name !== "calories");
  const additionalNutrients = nutrients.filter((name) => !coveredNutrients.has(name));

  const topics: string[] = [];
  if (allergies.length) {
    const subject = allergies.length === 1 ? "Food allergy" : "Food allergies";
    topics.push(`${subject}: ${allergies.join(", ")}. Check the ingredient list, read allergen labels and prevent cross-contact`);
  }
  topics.push(...uniqueLabels(conditionTopics.map((topic) => topic.text)));
  if (additionalNutrients.length) topics.push(`Food sources and choices for ${additionalNutrients.join(", ")}`);

  const hasConditionContext = conditions.length > 0 || nutrients.length > 0;
  const diet = key(input.profile.dietType ?? "");
  if (DIET_STYLES.has(diet)) topics.push(`${diet} food choices`);
  if (!hasConditionContext && !allergies.length) {
    topics.push(...uniqueLabels(input.goalTypes.map((goal) => topicFor(GOAL_TOPICS, key(goal)) ?? "")));
  }
  if (topics.length === 0) topics.push("Healthy food choices: vegetables, fruits, whole grains and protein foods for balanced meals");

  if (input.purpose === "recipe_generation") {
    topics.push(input.mealSlot ? `Choose recipe ingredients for ${input.mealSlot}` : "Choose recipe ingredients");
  } else if (input.purpose === "staple_allocation") {
    topics.push("Choose ingredients across meals");
  }

  const joined = topics.join(". ") + ".";
  const question = joined.length <= MAX_QUERY_CHARS
    ? joined
    : joined.slice(0, MAX_QUERY_CHARS - 1).trimEnd() + "…";

  const intent = allergies.length ? "safety"
    : input.purpose !== "dashboard_suggestion" ? "food_specific"
    : hasConditionContext ? "condition_specific" : "general";
  return { question, hints: { intent, hasConditionContext } };
}

export function ragQueryInputFromContext(
  ctx: RecipeGenerationContext,
  purpose: PersonalizedRagQueryInput["purpose"],
): PersonalizedRagQueryInput {
  return {
    purpose,
    ...(purpose === "recipe_generation" ? { mealSlot: ctx.mealSlot } : {}),
    profile: {
      dietType: ctx.profile.dietType,
      allergies: ctx.profile.allergies,
    },
    goalTypes: ctx.goalsDetailed.map((g) => g.goalType),
    healthDetailed: ctx.healthDetailed,
    conditionRelatedThresholds: ctx.conditionRelatedThresholds ?? [],
  };
}
