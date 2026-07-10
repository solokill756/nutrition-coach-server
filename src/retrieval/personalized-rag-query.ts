import type { UserNutrientThreshold } from "../nutrition/user-context.service";
import { formatThresholdMinMax } from "../nutrition/condition-related-thresholds";
import type { RetrievalHints } from "./retrieval.types";

const MAX_QUERY_CHARS = 2800;

export type PersonalizedRagHealthCondition = {
  conditionName: string;
};

export type PersonalizedRagQueryInput = {
  /** Distinguishes extra keywords only; core query schema is shared. */
  purpose: "recipe_generation" | "dashboard_suggestion";
  profile: {
    sex?: string | null;
    dietType?: string | null;
    allergies?: string[];
    fitnessLevel?: string | null;
  };
  goalTypes: string[];
  healthDetailed: PersonalizedRagHealthCondition[];
  conditionRelatedThresholds: UserNutrientThreshold[];
};

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function clip(s: string, max: number): string {
  const t = squash(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function uniqueNonEmpty(parts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const p = squash(raw);
    if (!p) continue;
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * Shared RAG retrieval query for Recipe Builder and Dashboard AI.
 * Uses static profile, goals, health conditions, allergies, and
 * condition-related nutrient min/max only (no diary intake or daily totals).
 */
export function buildPersonalizedRagQuery(input: PersonalizedRagQueryInput): {
  question: string;
  hints: RetrievalHints;
} {
  const p = input.profile;
  const conditionThresholds = input.conditionRelatedThresholds ?? [];

  const demographics = uniqueNonEmpty([p.sex ? `sex ${p.sex}` : ""]).join(", ");
  const goalsPhrase = uniqueNonEmpty(input.goalTypes.map((g) => String(g || "").trim())).join("; ");
  const allergiesPhrase = uniqueNonEmpty(p.allergies || []).join(", ");
  const thresholdPhrase = uniqueNonEmpty(
    conditionThresholds.map((t) => formatThresholdMinMax(t)),
  ).join("; ");
  const healthPhrase = uniqueNonEmpty(
    input.healthDetailed.map((h) => String(h.conditionName || "").trim()),
  ).join("; ");

  const diet = p.dietType?.trim();
  const fitness = p.fitnessLevel?.trim();

  const purposeLead =
    input.purpose === "dashboard_suggestion"
      ? "Daily personalized nutrition guidance based on user profile, active goals, health conditions, and condition-related nutrient limits only."
      : "Personalized nutrition and safe cooking guidance based on user profile, active goals, health conditions, and condition-related nutrient limits only.";

  const narrativeParts = [
    purposeLead,
    demographics ? `User metrics: ${demographics}.` : "",
    goalsPhrase ? `Active goals (UserGoal): ${goalsPhrase}.` : "",
    healthPhrase ? `Health conditions (UserHealthCondition): ${healthPhrase}.` : "",
    allergiesPhrase ? `Allergies (AppUser): ${allergiesPhrase}.` : "",
    diet ? `Diet type (AppUser): ${diet}.` : "",
    fitness ? `Fitness level (AppUser): ${fitness}.` : "",
    thresholdPhrase
      ? `Condition-related nutrient limits (UserNutritionalThreshold): ${thresholdPhrase}.`
      : "",
  ].filter(Boolean);

  const purposeKeywords =
    input.purpose === "dashboard_suggestion"
      ? ["dashboard", "daily suggestion", "practical action"]
      : ["cooking", "recipe"];

  const keywordTokens = uniqueNonEmpty([
    "nutrition",
    "diet",
    "healthy eating",
    ...purposeKeywords,
    ...(p.allergies || []),
    ...(diet ? [diet] : []),
    ...conditionThresholds.map((t) => String(t.nutrient || "")),
    ...input.healthDetailed.map((h) => String(h.conditionName || "")),
    ...input.goalTypes,
  ]);

  const keywordLine = `Keywords: ${keywordTokens.join(", ")}.`;
  let question = squash(`${narrativeParts.join(" ")} ${keywordLine}`);
  question = clip(question, MAX_QUERY_CHARS);

  const hasAllergies = (p.allergies?.length ?? 0) > 0;
  const hasConditionThresholds = conditionThresholds.length > 0;
  const hasHealthConditions = input.healthDetailed.length > 0;

  let intent: NonNullable<RetrievalHints["intent"]>;
  if (hasAllergies) {
    intent = "safety";
  } else if (input.purpose === "recipe_generation") {
    intent = "food_specific";
  } else if (hasConditionThresholds || hasHealthConditions) {
    intent = "condition_specific";
  } else {
    intent = "general";
  }

  return {
    question,
    hints: {
      intent,
      hasConditionContext: hasConditionThresholds || hasHealthConditions,
    },
  };
}
