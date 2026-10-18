import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import NodeCache from "node-cache";
import { Between, Repository } from "typeorm";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import { LogFoodEntity, LogFoodMealTypeEnum } from "../nutrition/entities/log-food.entity";
import {
  RecipeGenerationContext,
  UserContextService,
} from "../nutrition/user-context.service";
import { UserStapleFoodService } from "../nutrition/user-staple-food.service";
import { RecipeBuilderService } from "./recipe-builder.service";
import { RecipeMealSlot } from "./dto/recipe.dto";
import { RecipeEntity } from "./entities/recipe.entity";
import { calendarDayBounds, localDateKeyFromInstant, resolveClientDateKey } from "../common/date/calendar-day-bounds";
import {
  MEAL_SPLITS,
  MealNutritionTarget,
  scoreNutrition,
  scoreWarnings,
  slotTarget,
  thresholdMidpoint,
  userMealShare,
} from "./recipe-nutrition-scoring";
import { FridgeStapleAllocationService } from "./fridge-staple-allocation.service";
import type { StapleAllocationMap } from "./fridge-staple-allocation";

type FridgeSlotResult = {
  mealSlot: RecipeMealSlot;
  status: "existing" | "created" | "skipped";
  recipe: unknown;
  reason?: "logged" | "existing" | "no_budget";
  recommendation?: string;
  safetyWarnings?: string[];
  generationWarnings?: string[];
};

const SOURCE_TYPE = "fridge_ai_daily_plan";

const MEAL_SLOTS: RecipeMealSlot[] = ["breakfast", "lunch", "snack", "dinner"];

const EMPTY_SLOT_GENERATION_META = {
  recommendation: "",
  safetyWarnings: [] as string[],
  generationWarnings: [] as string[],
};

@Injectable()
export class FridgeMealPlannerService {
  private readonly logger = new Logger(FridgeMealPlannerService.name);
  /** In-memory lock cache: userId â†’ { dateKey, acquiredAt }. TTL = lockTtlMinutes. */
  private readonly lockCache = new NodeCache({ checkperiod: 60 });

  constructor(
    private readonly recipeBuilderService: RecipeBuilderService,
    private readonly stapleFoodService: UserStapleFoodService,
    private readonly userContextService: UserContextService,
    private readonly config: ConfigService,
    @InjectRepository(AppUserEntity)
    private readonly userRepo: Repository<AppUserEntity>,
    @InjectRepository(LogFoodEntity)
    private readonly logFoodRepo: Repository<LogFoodEntity>,
    @InjectRepository(RecipeEntity)
    private readonly recipeRepo: Repository<RecipeEntity>,
    private readonly stapleAllocationService: FridgeStapleAllocationService,
  ) {}

  private _recipeDetailCache = new Map<string, unknown>();

  private getRecipeByIdCached(userId: number, recipe: RecipeEntity): Promise<unknown> {
    const key = `${userId}:${recipe.id}`;
    const cached = this._recipeDetailCache.get(key);
    if (cached) {
      return Promise.resolve(cached);
    }
    return this.recipeBuilderService.getRecipeById(userId, Number(recipe.id)).then((detail) => {
      this._recipeDetailCache.set(key, detail);
      return detail;
    });
  }

  private clearRecipeDetailCache(): void {
    this._recipeDetailCache.clear();
  }

  private slotFieldsFromRecipeDetail(recipe: unknown): {
    recommendation: string;
    safetyWarnings: string[];
    generationWarnings: string[];
  } {
    if (!recipe || typeof recipe !== "object") {
      return { ...EMPTY_SLOT_GENERATION_META };
    }
    const detail = recipe as Record<string, unknown>;
    const asStringList = (value: unknown): string[] =>
      Array.isArray(value) ? value.map((item) => String(item)) : [];
    return {
      recommendation: String(detail.recommendation ?? ""),
      safetyWarnings: asStringList(detail.safetyWarnings),
      generationWarnings: asStringList(detail.generationWarnings),
    };
  }

  private resolveDateKey(clientDate?: string, tzOffsetMinutes = 0): string {
    return resolveClientDateKey(clientDate, tzOffsetMinutes);
  }

  getManualQuota(userId: number, _dateKey?: string, _tzOffsetMinutes = 0) {
    return { inProgress: this.lockCache.has(String(userId)) };
  }

  async generateManualPlan(
    userId: number,
    dateKey?: string,
    options: { replace?: boolean } = {},
    tzOffsetMinutes = 0,
  ) {
    const key = this.resolveDateKey(dateKey, tzOffsetMinutes);
    this.acquireGenerationLock(userId, key);
    try {
      return await this.generateDailyPlan(userId, key, options, tzOffsetMinutes);
    } finally {
      this.releaseGenerationLock(userId);
      this.clearRecipeDetailCache();
    }
  }

  private lockTtlSeconds(): number {
    const raw = Number(this.config.get<number>("FRIDGE_PLAN_LOCK_TTL_MINUTES") ?? 10) * 60;
    return Number.isFinite(raw) && raw > 0 ? raw : 600;
  }

  /** Acquire in-memory generation lock. Throws 409 if lock already held (non-stale). */
  private acquireGenerationLock(userId: number, dateKey: string): void {
    const key = String(userId);
    const existing = this.lockCache.get<{ userId: number; dateKey: string }>(key);
    if (existing) {
      throw new HttpException(
        {
          errorKey: "fridgePlan.errors.generationInProgress",
          message: "A fridge plan is already being generated.",
        },
        HttpStatus.CONFLICT,
      );
    }
    this.lockCache.set(key, { userId, dateKey }, this.lockTtlSeconds());
  }

  private releaseGenerationLock(userId: number): void {
    this.lockCache.del(String(userId));
  }

  async generateDailyPlan(
    userId: number,
    clientDateKey?: string,
    options: { replace?: boolean } = {},
    tzOffsetMinutes = 0,
  ): Promise<{ dateKey: string; sourceType: string; slots: FridgeSlotResult[] }> {
    const dateKey = this.resolveDateKey(clientDateKey, tzOffsetMinutes);
    const staples = await this.stapleFoodService.listWithFood(userId);
    if (staples.length < 2) {
      throw new BadRequestException("Add at least two staple foods before generating a fridge meal plan.");
    }

    const ctx = await this.userContextService.assembleRecipeGenerationContext(
      userId,
      dateKey,
      "breakfast",
      tzOffsetMinutes,
    );
    const loggedSlots = await this.loggedMealSlots(userId, dateKey, tzOffsetMinutes);
    const existingBySlot = await this.generatedRecipeRowsBySlot(userId, dateKey);
    const slots: FridgeSlotResult[] = [];
    const slotsToGenerate: RecipeMealSlot[] = [];
    let keptGeneratedCalories = 0;

    for (const mealSlot of MEAL_SLOTS) {
      if (loggedSlots.has(mealSlot)) {
        slots.push({
          mealSlot,
          status: "skipped",
          recipe: null,
          reason: "logged",
          ...EMPTY_SLOT_GENERATION_META,
        });
        continue;
      }
      const existing = existingBySlot.get(mealSlot);
      if (existing && !options.replace) {
        const recipe = await this.getRecipeByIdCached(userId, existing);
        keptGeneratedCalories += this.generatedRecipeCalories(existing) || this.recipeDetailCalories(recipe);
        slots.push({
          mealSlot,
          status: "existing",
          recipe,
          reason: "existing",
          ...this.slotFieldsFromRecipeDetail(recipe),
        });
        continue;
      }
      slotsToGenerate.push(mealSlot);
    }

    const remainingCalories = this.remainingPlanCalories(ctx, keptGeneratedCalories);
    if (remainingCalories <= 0) {
      for (const mealSlot of slotsToGenerate) {
        slots.push({
          mealSlot,
          status: "skipped",
          recipe: null,
          reason: "no_budget",
          ...EMPTY_SLOT_GENERATION_META,
        });
      }
      return { dateKey, sourceType: SOURCE_TYPE, slots: this.sortSlots(slots) };
    }

    const targetsBySlot = this.targetsForSlots(ctx, slotsToGenerate, remainingCalories);
    // Meals without a target (0% of the user's day) get no staples: they are skipped below.
    const plannedSlots = slotsToGenerate.filter((slot) => targetsBySlot.has(slot));
    const allocationResult = await this.stapleAllocationService.allocateStaplesForPlan({
      staples,
      generatingSlots: plannedSlots,
      ctx,
      slotTargets: targetsBySlot,
    });
    if (allocationResult.source === "heuristic") {
      this.logger.warn(
        `Fridge plan staple allocation used heuristic dateKey=${dateKey} reason=${allocationResult.fallbackReason ?? "unknown"}`,
      );
    }
    const allocations = allocationResult.allocations;
    for (const mealSlot of slotsToGenerate) {
      const target = targetsBySlot.get(mealSlot);
      if (!target || target.calories <= 0) {
        slots.push({
          mealSlot,
          status: "skipped",
          recipe: null,
          reason: "no_budget",
          ...EMPTY_SLOT_GENERATION_META,
        });
        continue;
      }
      slots.push(await this.generateSlot(userId, dateKey, mealSlot, staples, {
        ...options,
        tzOffsetMinutes,
        target,
        selectedFoodIds: allocations[mealSlot] ?? [],
      }));
    }
    return { dateKey, sourceType: SOURCE_TYPE, slots: this.sortSlots(slots) };
  }

  async regenerateSlot(
    userId: number,
    dateKey: string,
    mealSlot: RecipeMealSlot,
    tzOffsetMinutes = 0,
  ): Promise<FridgeSlotResult> {
    const staples = await this.stapleFoodService.listWithFood(userId);
    if (staples.length < 2) {
      throw new BadRequestException("Add at least two staple foods before regenerating a fridge recipe.");
    }
    this.acquireGenerationLock(userId, dateKey);
    try {
      const ctx = await this.userContextService.assembleRecipeGenerationContext(
        userId,
        dateKey,
        mealSlot,
        tzOffsetMinutes,
      );
      const loggedSlots = await this.loggedMealSlots(userId, dateKey, tzOffsetMinutes);
      if (loggedSlots.has(mealSlot)) {
        return {
          mealSlot,
          status: "skipped",
          recipe: null,
          reason: "logged",
          ...EMPTY_SLOT_GENERATION_META,
        };
      }
      const existingBySlot = await this.generatedRecipeRowsBySlot(userId, dateKey);
      let keptGeneratedCalories = 0;
      for (const [slot, recipe] of existingBySlot.entries()) {
        if (slot === mealSlot || loggedSlots.has(slot)) continue;
        const detail = await this.getRecipeByIdCached(userId, recipe);
        keptGeneratedCalories += this.generatedRecipeCalories(recipe) || this.recipeDetailCalories(detail);
      }
      const remainingCalories = this.remainingPlanCalories(ctx, keptGeneratedCalories);
      const target = this.targetsForSlots(ctx, [mealSlot], remainingCalories).get(mealSlot);
      if (!target || target.calories <= 0) {
        return {
          mealSlot,
          status: "skipped",
          recipe: null,
          reason: "no_budget",
          ...EMPTY_SLOT_GENERATION_META,
        };
      }
      const alreadyAllocated = await this.buildAlreadyAllocated(userId, dateKey, mealSlot);
      const targetsBySlot = this.targetsForSlots(ctx, [mealSlot], remainingCalories);
      const allocationResult = await this.stapleAllocationService.allocateStaplesForPlan({
        staples,
        generatingSlots: [mealSlot],
        ctx,
        slotTargets: targetsBySlot,
        alreadyAllocated,
        regenerateSlot: mealSlot,
      });
      if (allocationResult.source === "heuristic") {
        this.logger.warn(
          `Fridge regenerate staple allocation used heuristic dateKey=${dateKey} slot=${mealSlot} reason=${allocationResult.fallbackReason ?? "unknown"}`,
        );
      }
      return await this.generateSlot(userId, dateKey, mealSlot, staples, {
        replace: true,
        tzOffsetMinutes,
        target,
        selectedFoodIds: allocationResult.allocations[mealSlot] ?? [],
      });
    } finally {
      await this.releaseGenerationLock(userId);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyCron(): Promise<void> {
    if (String(this.config.get<string>("FRIDGE_PLAN_CRON_ENABLED") || "true").toLowerCase() === "false") {
      return;
    }
    const users = await this.userRepo.find({
      where: { delFlag: false, status: 1 },
      order: { id: "ASC" },
      take: Number(this.config.get<number>("FRIDGE_PLAN_CRON_BATCH_SIZE") || 50),
    });
    const dateKey = resolveClientDateKey(undefined, 0);
    for (const user of users) {
      try {
        await this.generateDailyPlan(Number(user.id), dateKey, {}, 0);
      } catch (error) {
        this.logger.warn(
          `Daily fridge plan skipped for userId=${user.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async generateSlot(
    userId: number,
    dateKey: string,
    mealSlot: RecipeMealSlot,
    staples: FoodNutritionEntity[],
    options: {
      replace?: boolean;
      target?: MealNutritionTarget;
      selectedFoodIds: number[];
      tzOffsetMinutes?: number;
    },
  ): Promise<FridgeSlotResult> {
    if (!options.replace) {
      const existing = await this.recipeBuilderService.findGeneratedRecipe(
        userId,
        dateKey,
        mealSlot,
        SOURCE_TYPE,
      );
      if (existing) {
        return {
          mealSlot,
          status: "existing",
          recipe: existing,
          ...this.slotFieldsFromRecipeDetail(existing),
        };
      }
    } else {
      await this.recipeBuilderService.softDeleteGeneratedRecipeSlot(
        userId,
        dateKey,
        mealSlot,
        SOURCE_TYPE,
      );
    }

    const ctx = await this.userContextService.assembleRecipeGenerationContext(
      userId,
      dateKey,
      mealSlot,
      options.tzOffsetMinutes ?? 0,
    );
    const target = options.target ?? slotTarget(ctx, mealSlot);
    const selectedFoods = options.selectedFoodIds
      .map((id) => staples.find((f) => Number(f.id) === Number(id)))
      .filter((f): f is FoodNutritionEntity => f != null);
    if (selectedFoods.length < 2) {
      throw new BadRequestException(
        `Not enough staple foods allocated for ${mealSlot}. Add more pantry items.`,
      );
    }
    const generation = await this.recipeBuilderService.generateRecipe(
      {
        mealSlot,
        date: dateKey,
        foodIds: selectedFoods.map((food) => Number(food.id)),
        constraints: {
          minCalories: Math.round(target.calories * 0.85),
          maxCalories: Math.round(target.calories),
          difficulty: "easy",
        },
      },
      userId,
    );

    const warnings = [
      ...generation.safetyWarnings,
      ...(generation.generationWarnings ?? []),
      ...scoreWarnings(generation.recipe.nutritionPerServing ?? {}, target),
    ];
    const score = scoreNutrition(generation.recipe.nutritionPerServing ?? {}, target);
    const saved = await this.recipeBuilderService.createGeneratedRecipe(
      userId,
      generation.recipe,
      {
        sourceType: SOURCE_TYPE,
        dateKey,
        mealSlot,
        nutritionTarget: target,
        nutritionActual: generation.recipe.nutritionPerServing ?? {},
        score,
        warnings,
        recommendation: generation.recommendation ?? "",
        safetyWarnings: generation.safetyWarnings ?? [],
        generationWarnings: generation.generationWarnings ?? [],
        selectedFoodIds: selectedFoods.map((food) => Number(food.id)),
        budgetStatus: generation.budgetStatus ?? "ok",
      },
    );

    return {
      mealSlot,
      status: "created",
      recipe: saved,
      recommendation: generation.recommendation ?? "",
      safetyWarnings: generation.safetyWarnings ?? [],
      generationWarnings: generation.generationWarnings ?? [],
    };
  }

  private targetsForSlots(
    ctx: RecipeGenerationContext,
    slots: RecipeMealSlot[],
    remainingCalories: number,
  ): Map<RecipeMealSlot, MealNutritionTarget> {
    // The user's split; 0% meals are skipped. If every chosen meal is 0%, use the default.
    const userShares = slots.map((slot) => [slot, userMealShare(ctx, slot)] as const);
    const anyPositive = userShares.some(([, share]) => share > 0);
    const shares = new Map(
      userShares.map(([slot, share]) => [slot, anyPositive ? share : MEAL_SPLITS[slot]]),
    );
    const totalSplit = [...shares.values()].reduce((sum, share) => sum + share, 0);
    const targets = new Map<RecipeMealSlot, MealNutritionTarget>();
    if (slots.length === 0 || totalSplit <= 0 || remainingCalories <= 0) {
      return targets;
    }
    const dailyCalories =
      ctx.dailyTargetCalories ??
      thresholdMidpoint(ctx, "calories") ??
      Math.max(1600, Math.round((ctx.remaining.calories ?? 2000) + ctx.todayIntake.totalCalories));
    for (const slot of slots) {
      const share = shares.get(slot) ?? 0;
      if (share <= 0) continue;
      const normalizedSplit = share / totalSplit;
      const calories = Math.max(0, Math.round(remainingCalories * normalizedSplit));
      const calorieRatio = dailyCalories > 0 ? calories / dailyCalories : normalizedSplit;
      targets.set(slot, {
        calories,
        protein: Math.round((thresholdMidpoint(ctx, "protein") ?? (dailyCalories * 0.25) / 4) * calorieRatio),
        carbs: Math.round((thresholdMidpoint(ctx, "carbs") ?? (dailyCalories * 0.5) / 4) * calorieRatio),
        fat: Math.round((thresholdMidpoint(ctx, "fat") ?? (dailyCalories * 0.25) / 9) * calorieRatio),
      });
    }
    return targets;
  }

  private remainingPlanCalories(ctx: RecipeGenerationContext, keptGeneratedCalories: number): number {
    const target =
      ctx.dailyTargetCalories ??
      thresholdMidpoint(ctx, "calories") ??
      Math.max(1600, Math.round((ctx.remaining.calories ?? 2000) + ctx.todayIntake.totalCalories));
    return Math.max(0, Math.round(target - ctx.todayIntake.totalCalories - keptGeneratedCalories));
  }

  private async loggedMealSlots(
    userId: number,
    dateKey: string,
    tzOffsetMinutes = 0,
  ): Promise<Set<RecipeMealSlot>> {
    const { start, end } = calendarDayBounds(dateKey, tzOffsetMinutes);
    const rows = await this.logFoodRepo.find({
      where: {
        userId,
        delFlag: false,
        loggedAt: Between(start, end),
      },
    });
    return new Set(
      rows
        .map((row) => this.logMealSlot(row))
        .filter((slot): slot is RecipeMealSlot => slot != null),
    );
  }

  private logMealSlot(row: LogFoodEntity): RecipeMealSlot | null {
    if (row.mealType === LogFoodMealTypeEnum.breakfast) return "breakfast";
    if (row.mealType === LogFoodMealTypeEnum.lunch) return "lunch";
    if (row.mealType === LogFoodMealTypeEnum.dinner) return "dinner";
    if (row.mealType === LogFoodMealTypeEnum.snack) return "snack";
    switch (Number(row.meal)) {
      case 2:
        return "lunch";
      case 3:
        return "dinner";
      case 4:
        return "snack";
      case 1:
      default:
        return "breakfast";
    }
  }

  private async generatedRecipeRowsBySlot(
    userId: number,
    dateKey: string,
  ): Promise<Map<RecipeMealSlot, RecipeEntity>> {
    const rows = await this.recipeRepo.find({
      where: { userId, delFlag: false },
      order: { createdAt: "DESC", id: "DESC" },
    });
    const map = new Map<RecipeMealSlot, RecipeEntity>();
    for (const row of rows) {
      const meta = this.safeParse(row.source);
      const slot = meta.mealSlot as RecipeMealSlot | undefined;
      if (
        meta.sourceType === SOURCE_TYPE &&
        meta.dateKey === dateKey &&
        slot != null &&
        MEAL_SLOTS.includes(slot) &&
        !map.has(slot)
      ) {
        map.set(slot, row);
      }
    }
    return map;
  }

  private generatedRecipeCalories(recipe: RecipeEntity): number {
    const meta = this.safeParse(recipe.source);
    const actual = meta.nutritionActual as { calories?: unknown } | undefined;
    const calories = Number(actual?.calories ?? 0);
    return Number.isFinite(calories) && calories > 0 ? calories : 0;
  }

  private recipeDetailCalories(recipe: unknown): number {
    const value = (recipe as { nutritionPerServing?: { calories?: unknown } } | null)?.nutritionPerServing?.calories;
    const calories = Number(value ?? 0);
    return Number.isFinite(calories) && calories > 0 ? calories : 0;
  }

  private sortSlots(slots: FridgeSlotResult[]): FridgeSlotResult[] {
    return [...slots].sort(
      (a, b) => MEAL_SLOTS.indexOf(a.mealSlot) - MEAL_SLOTS.indexOf(b.mealSlot),
    );
  }

  private async buildAlreadyAllocated(
    userId: number,
    dateKey: string,
    excludeSlot?: RecipeMealSlot,
  ): Promise<StapleAllocationMap> {
    const bySlot = await this.generatedRecipeRowsBySlot(userId, dateKey);
    const out: StapleAllocationMap = {};
    for (const [slot, row] of bySlot.entries()) {
      if (excludeSlot && slot === excludeSlot) continue;
      const meta = this.safeParse(row.source);
      const ids = Array.isArray(meta.selectedFoodIds)
        ? meta.selectedFoodIds.map((id) => Number(id)).filter((id) => id >= 1)
        : [];
      if (ids.length > 0) out[slot] = ids;
    }
    return out;
  }

  private safeParse(value: string | null | undefined): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
}
