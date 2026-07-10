export type AuthNutritionTargets = {
  targetCalories: number;
  bmr: number;
  tdee: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  carbsPercent: number;
  proteinPercent: number;
  fatPercent: number;
};

/** Active rows from UserNutritionalThreshold (min/max band per nutrient). */
export type AuthNutritionalThreshold = {
  nutrient: string;
  minAmount: number | null;
  maxAmount: number | null;
  unit: string;
};

export type AuthUser = {
  id: number;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  status: number;
  isProfileComplete: boolean;
  /** Profile fields from AppUser (onboarding / basic info). */
  age?: number | null;
  gender?: string | null;
  heightCm?: number | null;
  currentWeightKg?: number | null;
  startWeightKg?: number | null;
  goalWeightKg?: number | null;
  /** Active goal slug when a goal row exists (may exist before targets are ready). */
  goalType?: string | null;
  /** Lifestyle/onboarding fields persisted on AppUser. */
  activityLevel?: string | null;
  mealPlanningFrequency?: string | null;
  barriers?: string[];
  /** Active condition names from UserHealthCondition. */
  conditionTypes?: string[];
  /** From active goal + thresholds after onboarding; null if incomplete or missing data. */
  nutritionTargets?: AuthNutritionTargets | null;
  /** Active nutritional thresholds (same source as macro bands / sodium caps). */
  nutritionalThresholds?: AuthNutritionalThreshold[];
};

export type JwtAccessPayload = {
  sub: number;
  email: string | null;
  type: "access";
};

export type JwtRefreshPayload = {
  sub: number;
  sid: string;
  type: "refresh";
};

export type ExternalProvider = "google" | "apple";

export type ExternalIdentity = {
  provider: ExternalProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};
