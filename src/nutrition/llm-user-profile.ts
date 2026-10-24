import { formatThresholdMinMax } from "./condition-related-thresholds";
import type { RecipeGenerationContext } from "./user-context.service";

export type LlmUserProfile = {
  age: number | null;
  sex: string | null;
  heightCm: number | null;
  weightKg: number | null;
  goalWeightKg: number | null;
  dietType: string | null;
  allergies: string[];
  fitnessLevel: string | null;
  goals: string[];
  healthConditions: string[];
  nutrientLimits: string[];
  today: { intake: Record<string, number>; remaining: Record<string, number> };
};

const round1 = (x: number): number => Math.round(x * 10) / 10;

export function buildLlmUserProfile(ctx: RecipeGenerationContext): LlmUserProfile {
  const { profile } = ctx;

  const nutrientLimits = [
    ...new Set(
      [...ctx.thresholds, ...ctx.conditionRelatedThresholds]
        .map(formatThresholdMinMax)
        .filter(Boolean),
    ),
  ];

  const intake: Record<string, number> = {};
  for (const [k, v] of Object.entries(ctx.todayIntake)) {
    if (k === "totalCalories" || typeof v !== "number" || !Number.isFinite(v)) continue;
    intake[k] = round1(v);
  }

  const remaining: Record<string, number> = {};
  for (const [k, v] of Object.entries(ctx.remaining)) {
    if (k === "calories" || v == null || !Number.isFinite(Number(v))) continue;
    remaining[k] = round1(Number(v));
  }

  return {
    age: profile.age ?? null,
    sex: profile.sex ?? null,
    heightCm: profile.height ?? null,
    weightKg: profile.weight ?? null,
    goalWeightKg: profile.goalWeight ?? null,
    dietType: profile.dietType ?? null,
    allergies: profile.allergies ?? [],
    fitnessLevel: profile.fitnessLevel ?? null,
    goals: ctx.goalsDetailed.map((g) => g.goalType),
    healthConditions: ctx.healthDetailed.map((h) => h.conditionName),
    nutrientLimits,
    today: { intake, remaining },
  };
}

export function formatLlmUserBlock(profile: LlmUserProfile): string {
  return "User (JSON):\n" + JSON.stringify(profile);
}
