import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, MoreThanOrEqual, In } from "typeorm";
import { UserGoalEntity } from "./entities/user-goal.entity";
import { UserHealthConditionEntity } from "./entities/user-health-condition.entity";
import {
  UserNutritionalThresholdEntity,
} from "./entities/user-nutritional-threshold.entity";
import { DailyNutritionSummaryEntity } from "./entities/daily-nutrition-summary.entity";
import { LogFoodEntity } from "./entities/log-food.entity";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import { RecipeEntity } from "../recipe-builder/entities/recipe.entity";
import { ConditionNutrientRuleEntity } from "./entities/condition-nutrient-rule.entity";
import { ConditionNutrientRuleApplierService } from "./condition-nutrient-rule-applier.service";
import { ConditionNutrientUnitService } from "./condition-nutrient-unit.service";
import { buildConditionRelatedThresholds } from "./condition-related-thresholds";
import { localDateKeyNow } from "../common/date/calendar-day-bounds";
import { resolveMealSplits, type MealSplitsFraction } from "./meal-splits";

export type RecipeGenerationMealSlot = "breakfast" | "lunch" | "dinner" | "snack";

/** Static part of the USV that rarely changes. Cached with TTL. */
interface UserStaticContext {
  profile: UserProfile;
  goals: { goalType: string; targetCalories: number | null }[];
  healthConditions: string[];
  healthDetailed: Array<{ conditionName: string }>;
  thresholds: UserNutrientThreshold[];
  /** Min/max thresholds for nutrients tied to the user's active health conditions (ConditionNutrientRule). */
  conditionRelatedThresholds: UserNutrientThreshold[];
  goalsDetailed: Array<{
    id: number;
    goalType: string;
    targetCalories: number | null;
    startDate: Date;
    endDate: Date | null;
  }>;
  dailyTargetCalories: number | null;
  mealSplits: MealSplitsFraction;
}

const USV_STATIC_TTL_MS = 5 * 60 * 1000; // 5 minutes
const USV_CACHE_MAX_SIZE = 10_000; // LRU eviction threshold

/** Default days of recipe log history */
const DEFAULT_LOG_HISTORY_DAYS = 3;

/** Shared user profile fields used by both Dashboard AI and Recipe Builder. */
export interface UserProfile {
  age: number | null;
  sex: string | null;
  weight: number | null;
  goalWeight: number | null;
  height: number | null;
  dietType: string | null;
  allergies: string[];
  fitnessLevel: string;
}

/** Single nutrient threshold entry shared across contexts. */
export interface UserNutrientThreshold {
  nutrient: string;
  maxAmount: number | null;
  minAmount: number | null;
  unit: string;
}

/** Recent food log entry shared across contexts. */
export interface UserFoodHistoryEntry {
  foodName: string;
  mealType: string;
  calories: number;
  loggedAt: Date;
}

export interface RecipeGenerationContext {
  userId: number;
  dateKey: string;
  mealSlot: RecipeGenerationMealSlot;
  /** Configured via USV_LOG_HISTORY_DAYS env. */
  recentLogHistoryDays: number;
  profile: UserProfile;
  goalsDetailed: Array<{
    id: number;
    goalType: string;
    targetCalories: number | null;
    startDate: Date;
    endDate: Date | null;
  }>;
  healthDetailed: Array<{ conditionName: string }>;
  thresholds: UserNutrientThreshold[];
  /** Min/max for nutrients linked to active health conditions (used in RAG query). */
  conditionRelatedThresholds: UserNutrientThreshold[];
  recentHistory: UserFoodHistoryEntry[];
  recentRecipeLogs: Array<{
    recipeName: string;
    recipeId: number;
    loggedAt: Date;
    mealType: string;
  }>;
  todayIntake: {
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    totalSodium: number;
    totalSugar: number;
    totalSaturatedFat: number;
    totalCholesterol: number;
    totalPotassium: number;
  };
  dailyTargetCalories: number | null;
  /** The user's share of the day per meal (fractions); missing = MEAL_SPLITS. */
  mealSplits?: MealSplitsFraction;
  remaining: {
    calories: number | null;
    sodiumMg: number | null;
    carbsG: number | null;
    proteinG: number | null;
    fatG: number | null;
    sugarG: number | null;
    saturatedFatG: number | null;
    cholesterolMg: number | null;
    potassiumMgMinRemaining: number | null;
  };
}

export interface UserMealContext {
  userId: number;
  profile: UserProfile;
  goals: { goalType: string; targetCalories: number | null }[];
  healthConditions: string[];
  thresholds: UserNutrientThreshold[];
  recentHistory: UserFoodHistoryEntry[];
  todaySummary: {
    totalCalories: number;
    totalSodium: number;
    totalCarbs: number;
    totalProtein: number;
    totalFat: number;
    totalSugar: number;
    totalSaturatedFat: number;
    totalCholesterol: number;
    totalPotassium: number;
  } | null;
}

@Injectable()
export class UserContextService {
  private readonly logger = new Logger(UserContextService.name);
  private readonly logHistoryDays: number;

  /** In-memory USV static cache: userId → {data, expiresAt} */
  private readonly staticCache = new Map<number, { data: UserStaticContext; expiresAt: number }>();
  /** Pending load promises — cache stampede guard. Keyed by userId. */
  private readonly pendingLoads = new Map<number, Promise<UserStaticContext>>();
  /** Simple LRU order tracking (array of userIds, most-recently-used at end). */
  private readonly lruOrder: number[] = [];

  constructor(
    @InjectRepository(UserGoalEntity)
    private readonly goalRepo: Repository<UserGoalEntity>,
    @InjectRepository(UserHealthConditionEntity)
    private readonly healthRepo: Repository<UserHealthConditionEntity>,
    @InjectRepository(UserNutritionalThresholdEntity)
    private readonly thresholdRepo: Repository<UserNutritionalThresholdEntity>,
    @InjectRepository(DailyNutritionSummaryEntity)
    private readonly summaryRepo: Repository<DailyNutritionSummaryEntity>,
    @InjectRepository(LogFoodEntity)
    private readonly logRepo: Repository<LogFoodEntity>,
    @InjectRepository(AppUserEntity)
    private readonly userRepo: Repository<AppUserEntity>,
    @InjectRepository(FoodNutritionEntity)
    private readonly foodRepo: Repository<FoodNutritionEntity>,
    @InjectRepository(RecipeEntity)
    private readonly recipeRepo: Repository<RecipeEntity>,
    @InjectRepository(ConditionNutrientRuleEntity)
    private readonly ruleRepo: Repository<ConditionNutrientRuleEntity>,
    private readonly applier: ConditionNutrientRuleApplierService,
    private readonly units: ConditionNutrientUnitService,
    config: ConfigService,
  ) {
    this.logHistoryDays = Number(config.get<number>("USV_LOG_HISTORY_DAYS")) || DEFAULT_LOG_HISTORY_DAYS;
  }

  /** Invalidate cached static context for a user (call after profile/goal/health updates). */
  invalidateUserCache(userId: number): void {
    this.staticCache.delete(userId);
  }

  /** Touch userId in LRU order (move to end = most recently used). */
  private touchLru(userId: number): void {
    const idx = this.lruOrder.indexOf(userId);
    if (idx >= 0) this.lruOrder.splice(idx, 1);
    this.lruOrder.push(userId);
  }

  /** Evict oldest entries when cache exceeds max size. */
  private evictIfNeeded(): void {
    if (this.staticCache.size <= USV_CACHE_MAX_SIZE) return;
    const overflow = this.staticCache.size - USV_CACHE_MAX_SIZE;
    const toEvict = this.lruOrder.splice(0, overflow);
    for (const id of toEvict) this.staticCache.delete(id);
  }

  private static mealIntToSlug(meal: number): string {
    switch (meal) {
      case 2:
        return "lunch";
      case 3:
        return "dinner";
      case 4:
        return "snack";
      default:
        return "breakfast";
    }
  }

  /**
   * Load and cache the static part of the USV (profile, goals, health, thresholds).
   * Cached per-user with a 5-minute TTL. Call `invalidateUserCache()` after mutations.
   * Uses a pending-promise guard to prevent cache-stampede on concurrent requests.
   */
  private async loadStaticContext(userId: number): Promise<UserStaticContext> {
    // Fast path: cache hit
    const cached = this.staticCache.get(userId);
    if (cached && Date.now() < cached.expiresAt) {
      this.touchLru(userId);
      return cached.data;
    }

    // Stampede guard: piggyback on an in-flight load for the same user
    const inflight = this.pendingLoads.get(userId);
    if (inflight) return inflight;

    const promise = this.fetchStaticContext(userId);
    this.pendingLoads.set(userId, promise);

    try {
      const data = await promise;
      this.staticCache.set(userId, { data, expiresAt: Date.now() + USV_STATIC_TTL_MS });
      this.touchLru(userId);
      this.evictIfNeeded();
      return data;
    } finally {
      this.pendingLoads.delete(userId);
    }
  }

  private async fetchStaticContext(userId: number): Promise<UserStaticContext> {
    const [user, goals, health, thresholds] = await Promise.all([
      this.userRepo.findOne({ where: { id: userId } }),
      this.goalRepo.find({ where: { userId, isActive: true }, order: { id: "DESC" } }),
      this.healthRepo.find({ where: { userId, isActive: true } }),
      this.thresholdRepo.find({ where: { userId, isActive: true } }),
    ]);

    if (!user) throw new Error(`User ${userId} not found`);

    const conditionKeys = health.map((h) => String(h.conditionName || "").toLowerCase());
    const calorieGoal = goals.find((g) => g.targetCalories != null && Number(g.targetCalories) > 0);
    const dailyTargetCalories = calorieGoal != null ? Math.round(Number(calorieGoal.targetCalories)) : null;

    const mappedThresholds = thresholds.map((t) => ({
      nutrient: t.nutrient,
      maxAmount: t.maxAmount,
      minAmount: t.minAmount,
      unit: t.unit,
    }));

    const conditionRules =
      conditionKeys.length > 0
        ? await this.ruleRepo.find({ where: { conditionKey: In(conditionKeys), isActive: true } })
        : [];

    const conditionRelatedThresholds = buildConditionRelatedThresholds(
      conditionKeys,
      mappedThresholds,
      conditionRules.map((r) => ({
        conditionKey: r.conditionKey,
        nutrient: r.nutrient,
        minAmount: r.minAmount,
        maxAmount: r.maxAmount,
        unit: r.unit,
      })),
      (n) => this.units.normalizeNutrient(n),
    );

    const data: UserStaticContext = {
      profile: {
        age: user.age,
        sex: user.sex,
        weight: user.weight,
        goalWeight: user.goalWeight,
        height: user.height,
        dietType: user.dietType,
        allergies: user.allergies || [],
        fitnessLevel: user.fitnessLevel,
      },
      goals: goals.map((g) => ({ goalType: g.goalType, targetCalories: g.targetCalories })),
      healthConditions: health.map((h) => h.conditionName),
      healthDetailed: health.map((h) => ({ conditionName: h.conditionName })),
      thresholds: mappedThresholds,
      conditionRelatedThresholds,
      goalsDetailed: goals.map((g) => ({
        id: Number(g.id),
        goalType: g.goalType,
        targetCalories: g.targetCalories,
        startDate: g.startDate,
        endDate: g.endDate,
      })),
      dailyTargetCalories,
      mealSplits: resolveMealSplits(user.mealSplits),
    };

    return data;
  }

  /**
   * Full context for recipe generation: goals, health (+ severity), thresholds,
   * recipe history, remaining daily budget.
   */
  async assembleRecipeGenerationContext(
    userId: number,
    dateKey: string,
    mealSlot: RecipeGenerationMealSlot,
  ): Promise<RecipeGenerationContext> {
    const key = String(dateKey || "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      throw new Error("Invalid dateKey; expected YYYY-MM-DD");
    }

    const logSince = new Date();
    logSince.setDate(logSince.getDate() - this.logHistoryDays);

    // Static context (cached) + dynamic data fetched in parallel
    const [staticCtx, logRows, summary] = await Promise.all([
      this.loadStaticContext(userId),
      this.logRepo.find({
        where: { userId, delFlag: false, loggedAt: MoreThanOrEqual(logSince) },
        order: { loggedAt: "DESC", id: "DESC" },
        take: 50,
      }),
      this.summaryRepo.findOne({ where: { userId, date: key } }),
    ]);

    const recipeLogRows = logRows.filter((r) => r.recipeId != null && Number(r.recipeId) > 0);
    const recipeIds = [...new Set(recipeLogRows.map((r) => Number(r.recipeId)))];
    const recipes = recipeIds.length > 0
      ? await this.recipeRepo.find({ where: { id: In(recipeIds), delFlag: false } })
      : [];
    const recipeNameById = new Map(recipes.map((r) => [Number(r.id), r.name]));

    const recentHistory: UserFoodHistoryEntry[] = [];
    const recentRecipeLogs = recipeLogRows.slice(0, 5).map((r) => ({
      recipeName: recipeNameById.get(Number(r.recipeId)) ?? `Recipe ${r.recipeId}`,
      recipeId: Number(r.recipeId),
      loggedAt: r.loggedAt,
      mealType: UserContextService.mealIntToSlug(r.meal),
    }));

    const todayIntake = summary
      ? {
          totalCalories: Number(summary.totalCalories) || 0,
          totalProtein: Number(summary.totalProtein) || 0,
          totalCarbs: Number(summary.totalCarbs) || 0,
          totalFat: Number(summary.totalFat) || 0,
          totalSodium: Number(summary.totalSodium) || 0,
          totalSugar: Number(summary.totalSugar) || 0,
          totalSaturatedFat: Number(summary.totalSaturatedFat) || 0,
          totalCholesterol: Number(summary.totalCholesterol) || 0,
          totalPotassium: Number(summary.totalPotassium) || 0,
        }
      : {
          totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0,
          totalSodium: 0, totalSugar: 0, totalSaturatedFat: 0,
          totalCholesterol: 0, totalPotassium: 0,
        };

    const { thresholds, dailyTargetCalories } = staticCtx;
    const sodiumLimit = this.getThresholdMax(thresholds, "sodium");
    const carbsLimit = this.getThresholdMax(thresholds, "carbs");
    const proteinLimit = this.getThresholdMax(thresholds, "protein");
    const fatLimit = this.getThresholdMax(thresholds, "fat");
    const sugarLimit = this.getThresholdMax(thresholds, "sugars");
    const saturatedFatLimit = this.getThresholdMax(thresholds, "saturatedfat");
    const cholesterolLimit = this.getThresholdMax(thresholds, "cholesterol");
    const potassiumMin = this.getThresholdMin(thresholds, "potassium");

    return {
      userId,
      dateKey: key,
      mealSlot,
      recentLogHistoryDays: this.logHistoryDays,
      profile: staticCtx.profile,
      goalsDetailed: staticCtx.goalsDetailed,
      healthDetailed: staticCtx.healthDetailed,
      thresholds,
      conditionRelatedThresholds: staticCtx.conditionRelatedThresholds,
      recentHistory,
      recentRecipeLogs,
      todayIntake,
      dailyTargetCalories,
      mealSplits: staticCtx.mealSplits,
      remaining: {
        calories: dailyTargetCalories != null ? Math.max(0, dailyTargetCalories - todayIntake.totalCalories) : null,
        sodiumMg: sodiumLimit != null ? Math.max(0, sodiumLimit - todayIntake.totalSodium) : null,
        carbsG: carbsLimit != null ? Math.max(0, carbsLimit - todayIntake.totalCarbs) : null,
        proteinG: proteinLimit != null ? Math.max(0, proteinLimit - todayIntake.totalProtein) : null,
        fatG: fatLimit != null ? Math.max(0, fatLimit - todayIntake.totalFat) : null,
        sugarG: sugarLimit != null ? Math.max(0, sugarLimit - todayIntake.totalSugar) : null,
        saturatedFatG: saturatedFatLimit != null ? Math.max(0, saturatedFatLimit - todayIntake.totalSaturatedFat) : null,
        cholesterolMg: cholesterolLimit != null ? Math.max(0, cholesterolLimit - todayIntake.totalCholesterol) : null,
        potassiumMgMinRemaining: potassiumMin != null ? Math.max(0, potassiumMin - todayIntake.totalPotassium) : null,
      },
    };
  }

  private getThresholdMax(
    thresholds: UserNutrientThreshold[],
    nutrientLc: string,
  ): number | undefined {
    const t = thresholds.find((x) => String(x.nutrient || "").toLowerCase() === nutrientLc);
    if (t?.maxAmount != null && Number(t.maxAmount) > 0) {
      return Number(t.maxAmount);
    }
    return undefined;
  }

  private getThresholdMin(
    thresholds: UserNutrientThreshold[],
    nutrientLc: string,
  ): number | undefined {
    const t = thresholds.find((x) => String(x.nutrient || "").toLowerCase() === nutrientLc);
    if (t?.minAmount != null && Number(t.minAmount) > 0) {
      return Number(t.minAmount);
    }
    return undefined;
  }

  async assembleContext(userId: number, tzOffsetMinutes = 0): Promise<UserMealContext> {
    this.logger.log(`Assembling context for user ${userId}`);

    const today = localDateKeyNow(tzOffsetMinutes);

    // Static context (cached) + today's summary fetched in parallel
    const [staticCtx, summary] = await Promise.all([
      this.loadStaticContext(userId),
      this.summaryRepo.findOne({ where: { userId, date: today } }),
    ]);

    this.logger.log(
      `Context assembled for userId=${userId}: ${staticCtx.goals.length} goals, ` +
      `${staticCtx.healthConditions.length} health conditions, ${staticCtx.thresholds.length} thresholds.`,
    );

    return {
      userId,
      profile: staticCtx.profile,
      goals: staticCtx.goals,
      healthConditions: staticCtx.healthConditions,
      thresholds: staticCtx.thresholds,
      recentHistory: [],
      todaySummary: summary
        ? {
            totalCalories: summary.totalCalories,
            totalSodium: summary.totalSodium,
            totalCarbs: summary.totalCarbs,
            totalProtein: summary.totalProtein,
            totalFat: summary.totalFat,
            totalSugar: summary.totalSugar,
            totalSaturatedFat: summary.totalSaturatedFat,
            totalCholesterol: summary.totalCholesterol,
            totalPotassium: summary.totalPotassium,
          }
        : null,
    };
  }
}
