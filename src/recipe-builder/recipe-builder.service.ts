import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CreateRecipeDto,
  Recipe,
  RecipeBuilderRequest,
  RecipeBuilderResponse,
  RecipeMealSlot,
  UpdateRecipeDto,
} from "./dto/recipe.dto";
import { RetrievalService } from "../retrieval/retrieval.service";
import { RAG_CONFIDENCE_THRESHOLD } from "../retrieval/rag-confidence";
import { OllamaService } from "../ollama/ollama.service";
import { FoodService } from "../meal-planning/food.service";
import {
  RecipeGenerationContext,
  UserContextService,
  UserMealContext,
} from "../nutrition/user-context.service";
import { UserStapleFoodService } from "../nutrition/user-staple-food.service";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { RecipeEntity } from "./entities/recipe.entity";
import { RecipeIngredientEntity } from "./entities/recipe-ingredient.entity";
import { RecipeStepEntity } from "./entities/recipe-step.entity";
import { MealsService } from "../meal-planning/meals.service";
import { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import { buildRecipeGenerationRagQuery } from "./recipe-rag-query";
import { resolveClientDateKey } from "../common/date/calendar-day-bounds";
import {
  MEAL_SPLITS,
  scoreNutrition,
  scoreWarnings,
  slotCaloriesCap,
  slotTarget,
} from "./recipe-nutrition-scoring";
import { RECIPE_PROMPTS } from "./constants/recipe-prompts";

/** TypeORM maps `recipe.source` but not `recipe.source::jsonb` (PascalCase "Source" column). */
export const RECIPE_COMMUNITY_ACCESS_WHERE =
  "(recipe.userId = :userId OR (recipe.source IS NOT NULL AND \"recipe\".\"Source\"::jsonb ->> 'shareWith' = '2'))";

@Injectable()
export class RecipeBuilderService {
  private readonly logger = new Logger(RecipeBuilderService.name);

  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly ollamaService: OllamaService,
    private readonly config: ConfigService,
    private readonly userContextService: UserContextService,
    private readonly stapleFoodService: UserStapleFoodService,
    private readonly foodService: FoodService,
    private readonly mealsService: MealsService,
    @InjectRepository(RecipeEntity)
    private readonly recipeRepo: Repository<RecipeEntity>,
    @InjectRepository(RecipeIngredientEntity)
    private readonly recipeIngredientRepo: Repository<RecipeIngredientEntity>,
    @InjectRepository(RecipeStepEntity)
    private readonly recipeStepRepo: Repository<RecipeStepEntity>,
    @InjectRepository(FoodNutritionEntity)
    private readonly foodRepo: Repository<FoodNutritionEntity>,
  ) { }

  private finiteNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private nonNegativeNumber(value: unknown, fallback = 0): number {
    return Math.max(0, this.finiteNumber(value, fallback));
  }

  private positiveInteger(value: unknown, fallback: number): number {
    const n = Math.trunc(this.finiteNumber(value, fallback));
    return n > 0 ? n : fallback;
  }

  private nullableNonNegativeInteger(value: unknown): number | null {
    if (value == null || value === "") return null;
    const n = Math.trunc(this.finiteNumber(value, Number.NaN));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  async generateRecipe(
    input: RecipeBuilderRequest,
    userId: number,
    tzOffsetMinutes = 0,
  ): Promise<RecipeBuilderResponse> {
    if (userId == null) {
      throw new UnauthorizedException({
        errorKey: "recipeBuilder.errors.authRequired",
        message: "Authentication is required to generate a recipe.",
      });
    }
    return this.generateRecipeFromStaples(input, userId, tzOffsetMinutes);
  }

  private async generateRecipeFromStaples(
    input: RecipeBuilderRequest,
    userId: number,
    tzOffsetMinutes = 0,
  ): Promise<RecipeBuilderResponse> {
    if (!input.mealSlot) {
      throw new BadRequestException("mealSlot is required (breakfast | lunch | dinner | snack).");
    }

    const dateKey = resolveClientDateKey(input.date, tzOffsetMinutes);

    let staples: FoodNutritionEntity[];
    const requestedFoodIds = input.foodIds?.filter((id) => Number.isFinite(id) && id >= 1) ?? [];
    if (requestedFoodIds.length > 0) {
      const uniqueIds = [...new Set(requestedFoodIds.map((id) => Number(id)))];
      const foods = await this.foodRepo.find({ where: { id: In(uniqueIds) } });
      if (foods.length !== uniqueIds.length) {
        const found = new Set(foods.map((f) => Number(f.id)));
        const missing = uniqueIds.filter((id) => !found.has(id));
        throw new BadRequestException(
          `Unknown food id(s): ${missing.join(", ")}. Each id must exist in the food catalog.`,
        );
      }
      const forbidden = foods.filter(
        (f) => f.userId != null && Number(f.userId) !== Number(userId),
      );
      if (forbidden.length > 0) {
        throw new BadRequestException(
          "One or more foods are not available for your account.",
        );
      }
      const byId = new Map(foods.map((f) => [Number(f.id), f]));
      staples = uniqueIds.map((id) => byId.get(id)!);
    } else {
      staples = await this.stapleFoodService.listWithFood(userId);
      if (!staples.length) {
        throw new BadRequestException(
          "Add at least one staple food first (POST /recipe-builder/staples with { foodId }).",
        );
      }
    }

    const recipeCtx = await this.userContextService.assembleRecipeGenerationContext(
      userId,
      dateKey,
      input.mealSlot,
    );

    const stapleIds = new Set(staples.map((f) => Number(f.id)));
    const staplePayload = staples.map((f) => {
      const servingSizeG = f.servingSize > 0 ? f.servingSize : 100;
      const servingUnit = (f.servingUnit || "g").trim();
      // Only what the model needs to pick amounts; the server fills names, units
      // and nutrition back in from the catalog by foodId (and still accepts food_id).
      return {
        foodId: Number(f.id),
        foodName: f.foodName,
        caloriesPerServing: f.calories,
        proteinG: f.protein,
        carbsG: f.carbs,
        fatG: f.fat,
        sodiumMg: f.sodium,
        fiberG: f.fiber,
        servingSizeG,
        servingUnit,
      };
    });

    const userContextCompat = this.toUserMealContextFromRecipeCtx(recipeCtx);

    const constraints = input.constraints || {};
    const { question: ragQuery, hints: ragHints } = buildRecipeGenerationRagQuery(recipeCtx);
    const query = ragQuery;
    this.logger.log(
      `[RAG] Recipe generation query userId=${userId} mealSlot=${input.mealSlot} ` +
        `date=${dateKey} hints=${JSON.stringify(ragHints)} query="${query}"`,
    );
    const contexts = await this.retrievalService.retrieve(
      query,
      this.config.get<number>("TOP_K") || 8,
      ragHints,
    );


    const contextsToUse = contexts.filter((c) => c.score >= RAG_CONFIDENCE_THRESHOLD);
    this.logger.log(
      `[RAG] RetrievalService.retrieve userId=${userId} intent=${ragHints.intent ?? "general"} ` +
        `hasConditionContext=${ragHints.hasConditionContext ?? false} ` +
        `query="${query.slice(0, 160)}${query.length > 160 ? "…" : ""}" ` +
        `rawHits=${contexts.length} usedAfterScore>=${RAG_CONFIDENCE_THRESHOLD}=${contextsToUse.length} ` +
        `topScore=${contexts[0]?.score != null ? contexts[0].score.toFixed(3) : "n/a"}`,
    );
    if (contexts.length > 0 && contextsToUse.length === 0) {
      this.logger.warn(
        `[RAG] All ${contexts.length} chunks scored below ${RAG_CONFIDENCE_THRESHOLD}; LLM prompt Reference section will be empty.`,
      );
    }
    const contextText = contextsToUse
      .map((c) => `[${c.domain}] ${c.title}: ${c.content.slice(0, 300)}...`)
      .join("\n\n");

    const allowedIds = [...stapleIds].join(", ");
    // The same per-meal target the result is scored against, so the model
    // aims for what it will be judged on.
    const nutritionTarget = slotTarget(recipeCtx, input.mealSlot);
    const budgetLines: string[] = [
      `Aim for ONE serving of this ${input.mealSlot} at about ${nutritionTarget.calories} kcal, ` +
        `${nutritionTarget.protein} g protein, ${nutritionTarget.carbs} g carbs, ` +
        `${nutritionTarget.fat} g fat (stay within ±15%).`,
    ];
    const r = recipeCtx.remaining;
    const maxCalories = Number(constraints.maxCalories);
    const slotCapCalories = slotCaloriesCap(recipeCtx, input.mealSlot);
    const effectiveMaxCalories =
      Number.isFinite(maxCalories) && maxCalories > 0
        ? slotCapCalories != null
          ? Math.min(Math.round(maxCalories), slotCapCalories)
          : Math.round(maxCalories)
        : slotCapCalories;
    const minCalories = Number(constraints.minCalories);
    if (Number.isFinite(minCalories) && minCalories > 0) {
      budgetLines.push(`Target minimum kcal for ONE serving of this meal slot: ~${Math.round(minCalories)} kcal.`);
    }
    if (effectiveMaxCalories != null && effectiveMaxCalories > 0) {
      budgetLines.push(`Hard max kcal for ONE serving of this meal slot: ~${Math.round(effectiveMaxCalories)} kcal. Do not exceed this.`);
    }
    if (r.calories != null) {
      budgetLines.push(`Max kcal for ONE serving of this recipe (do not exceed remaining daily budget): ~${Math.round(r.calories)} kcal.`);
    }
    if (r.sodiumMg != null) {
      budgetLines.push(`Max sodium (mg) per serving for this recipe vs remaining today: ~${Math.round(r.sodiumMg)} mg.`);
    }
    if (r.carbsG != null) {
      budgetLines.push(`Max carbs (g) per serving: ~${Math.round(r.carbsG * 10) / 10} g remaining today.`);
    }
    if (r.proteinG != null) {
      budgetLines.push(`Protein left today (a ceiling, not a target): ~${Math.round(r.proteinG * 10) / 10} g.`);
    }
    if (r.fatG != null) {
      budgetLines.push(`Max fat (g) per serving: ~${Math.round(r.fatG * 10) / 10} g remaining today.`);
    }
    if (r.sugarG != null) {
      budgetLines.push(`Max sugars (g) per serving: ~${Math.round(r.sugarG * 10) / 10} g remaining today.`);
    }
    if (r.saturatedFatG != null) {
      budgetLines.push(`Max saturated fat (g) per serving: ~${Math.round(r.saturatedFatG * 10) / 10} g remaining today.`);
    }
    if (r.cholesterolMg != null) {
      budgetLines.push(`Max cholesterol (mg) per serving: ~${Math.round(r.cholesterolMg)} mg remaining today.`);
    }
    if (r.potassiumMgMinRemaining != null) {
      budgetLines.push(`Potassium target still needed today: ~${Math.round(r.potassiumMgMinRemaining)} mg.`);
    }

    const systemPrompt = RECIPE_PROMPTS.buildSystemPrompt(allowedIds, contextsToUse);

    const userPrompt = RECIPE_PROMPTS.buildUserPrompt(
      input.mealSlot,
      dateKey,
      recipeCtx,
      staplePayload,
      budgetLines,
      constraints,
      contextText,
      contextsToUse,
    );

    let recipeJson = "";
    try {
      recipeJson = await this.ollamaService.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);
    } catch (error) {
      console.error("[RECIPE-BUILDER] LLM error:", (error as any)?.message);
      throw new ServiceUnavailableException({
        errorKey: "recipeBuilder.errors.aiUnavailable",
        message: "Recipe AI is unavailable. Please try again later.",
      });
    }

    const parsedData = this.parseRecipeAiResponse(recipeJson);

    const recipe = parsedData.recipe;
    this.sanitizeStapleIngredients(recipe, stapleIds, staples);
    this.applyCatalogUnitsToIngredients(recipe, staples);

    let enrichedRecipe = await this.enrichRecipeWithRealNutrition(recipe);
    const generationWarnings: string[] = [];
    const effectiveRemaining = {
      ...recipeCtx.remaining,
      calories:
        effectiveMaxCalories != null && effectiveMaxCalories > 0
          ? Math.min(
              recipeCtx.remaining.calories ?? effectiveMaxCalories,
              effectiveMaxCalories,
            )
          : recipeCtx.remaining.calories,
    };
    let budgetStatus = this.clampRecipeToRemainingBudgets(
      enrichedRecipe,
      effectiveRemaining,
      generationWarnings,
    );
    if (budgetStatus === "adjusted") {
      enrichedRecipe = await this.enrichRecipeWithRealNutrition(enrichedRecipe);
      budgetStatus = this.verifyBudget(enrichedRecipe, effectiveRemaining, generationWarnings);
    }

    const score = scoreNutrition(
      enrichedRecipe.nutritionPerServing ?? {},
      nutritionTarget,
    );
    const recipeScoreWarnings = scoreWarnings(
      enrichedRecipe.nutritionPerServing ?? {},
      nutritionTarget,
    );

    return {
      recipe: enrichedRecipe,
      alternativeRecipes: parsedData.alternativeRecipes || [],
      recommendation: parsedData.recommendation || "",
      safetyWarnings: this.validateNutritionAgainstThresholds(
        enrichedRecipe,
        userContextCompat,
        input.mealSlot,
      ),
      generationWarnings,
      budgetStatus,
      score,
      nutritionTarget,
      scoreWarnings: recipeScoreWarnings,
      evidence: contextsToUse.map((c) => ({
        id: c.id,
        title: c.title,
        link: c.link,
        source: c.source,
        domain: c.domain,
        score: c.score,
        isChunk: c.isChunk,
        parentId: c.parentId,
        chunkIndex: c.chunkIndex,
        chunkTotal: c.chunkTotal,
      })),
    };
  }

  private toUserMealContextFromRecipeCtx(ctx: RecipeGenerationContext): UserMealContext {
    return {
      userId: ctx.userId,
      profile: ctx.profile,
      goals: ctx.goalsDetailed.map((g) => ({
        goalType: g.goalType,
        targetCalories: g.targetCalories,
      })),
      healthConditions: ctx.healthDetailed.map((h) => h.conditionName),
      thresholds: ctx.thresholds,
      recentHistory: ctx.recentHistory,
      todaySummary: {
        totalCalories: ctx.todayIntake.totalCalories,
        totalSodium: ctx.todayIntake.totalSodium,
        totalCarbs: ctx.todayIntake.totalCarbs,
        totalProtein: ctx.todayIntake.totalProtein,
        totalFat: ctx.todayIntake.totalFat,
        totalSugar: ctx.todayIntake.totalSugar,
        totalSaturatedFat: ctx.todayIntake.totalSaturatedFat,
        totalCholesterol: ctx.todayIntake.totalCholesterol,
        totalPotassium: ctx.todayIntake.totalPotassium,
      },
    };
  }

  /** Matches Flutter `formatServingLabelAmount` + first catalog unit (`{size} {servingUnit}`). */
  private formatServingLabelAmount(d: number): string {
    const r = Math.round(d);
    if (Math.abs(d - r) < 1e-9) {
      return String(r);
    }
    return String(d);
  }

  private catalogReferenceUnitLabel(row: FoodNutritionEntity): string {
    const size = row.servingSize > 0 ? row.servingSize : 100;
    const u = (row.servingUnit || "g").trim();
    return `${this.formatServingLabelAmount(size)} ${u}`.trim();
  }

  /**
   * Forces ingredient.unit / amount / amount_g to align with DB serving size so the mobile client
   * matches `LogFoodHelper.mapApiFoodToModel` unit list.
   */
  private applyCatalogUnitsToIngredients(recipe: Recipe, staples: FoodNutritionEntity[]): void {
    if (!recipe?.ingredients?.length) {
      return;
    }
    const byId = new Map(staples.map((s) => [Number(s.id), s]));
    for (const ing of recipe.ingredients) {
      const fid = Number((ing as any).foodId);
      const row = byId.get(fid);
      if (!row) {
        continue;
      }
      const serv = row.servingSize > 0 ? row.servingSize : 100;
      const label = this.catalogReferenceUnitLabel(row);
      let amountG = Number((ing as any).amount_g);

      if (!Number.isFinite(amountG) || amountG <= 0) {
        const amt = Number((ing as any).amount);
        if (Number.isFinite(amt) && amt > 0) {
          amountG = amt * serv;
        } else {
          // Missing amount_g or non-catalog unit (e.g. cup): one reference serving — prompt requires amount_g from LLM.
          amountG = serv;
        }
      }

      const portions = amountG / serv;
      (ing as any).foodId = fid;
      (ing as any).amount_g = Math.round(amountG * 1000) / 1000;
      (ing as any).unit = label;
      (ing as any).amount = Math.round(portions * 1000) / 1000;
      /** Reference serving size (g) for mobile: quantity = amount_g / servingSizeG when using first catalog unit. */
      (ing as any).servingSizeG = serv;
    }
  }

  private sanitizeStapleIngredients(
    recipe: Recipe,
    stapleIds: Set<number>,
    staples: FoodNutritionEntity[],
  ): void {
    if (!recipe?.ingredients?.length) {
      return;
    }
    const byName = new Map(staples.map((s) => [s.foodName.toLowerCase().trim(), s]));
    const kept: typeof recipe.ingredients = [];
    for (const ing of recipe.ingredients) {
      let fid = Number((ing as any).foodId ?? (ing as any).food_id);
      if (!Number.isFinite(fid) || !stapleIds.has(fid)) {
        const row = byName.get(String(ing.name || "").toLowerCase().trim());
        if (row) {
          fid = Number(row.id);
        }
      }
      if (!stapleIds.has(fid)) {
        continue;
      }
      (ing as any).foodId = fid;
      delete (ing as any).food_id;
      const row = staples.find((s) => Number(s.id) === fid);
      if (row) {
        ing.name = row.foodName;
      }
      kept.push(ing);
    }
    recipe.ingredients = kept;
  }

  /**
   * Scale ingredient grams down so per-serving nutrition fits remaining daily budget (conservative).
   * Returns budgetStatus: adjusted if scaling applied, warning if could not fully satisfy.
   */
  private clampRecipeToRemainingBudgets(
    recipe: Recipe,
    remaining: RecipeGenerationContext["remaining"],
    warnings: string[],
  ): "ok" | "adjusted" | "warning" {
    if (!recipe?.ingredients?.length) {
      return "ok";
    }
    const n = recipe.nutritionPerServing || {};
    let factor = 1;
    let needScale = false;

    const considerCap = (perServing: number | undefined, cap: number | null | undefined) => {
      if (cap == null || perServing == null || perServing <= 0 || cap <= 0) {
        return;
      }
      if (perServing > cap + 0.01) {
        const f = cap / perServing;
        if (f < factor) {
          factor = f;
          needScale = true;
        }
      }
    };

    considerCap(n.calories, remaining.calories);
    considerCap(n.sodium, remaining.sodiumMg);
    considerCap(n.carbs, remaining.carbsG);
    considerCap(n.protein, remaining.proteinG);
    considerCap(n.fat, remaining.fatG);
    considerCap(n.sugar, remaining.sugarG);
    considerCap(n.saturatedFat, remaining.saturatedFatG);
    considerCap(n.cholesterol, remaining.cholesterolMg);

    if (factor >= 0.999) {
      return "ok";
    }

    warnings.push(
      `Scaled ingredient amounts by ~${(factor * 100).toFixed(0)}% so one serving better fits remaining daily budget.`,
    );

    const minG = 10;
    for (const ing of recipe.ingredients) {
      if (typeof ing.amount_g === "number" && ing.amount_g > 0) {
        ing.amount_g = Math.max(minG, Math.round(ing.amount_g * factor * 10) / 10);
      }
      if (typeof ing.amount === "number" && ing.amount > 0) {
        ing.amount = Math.max(0.01, Math.round(ing.amount * factor * 1000) / 1000);
      }
    }

    return "adjusted";
  }

  private verifyBudget(
    recipe: Recipe,
    remaining: RecipeGenerationContext["remaining"],
    warnings: string[],
  ): "ok" | "adjusted" | "warning" {
    const n = recipe.nutritionPerServing || {};
    let bad = false;
    const check = (label: string, v: number | undefined, cap: number | null | undefined) => {
      if (cap == null || v == null) {
        return;
      }
      if (v > cap + 1) {
        bad = true;
        warnings.push(
          `After scaling, ${label} per serving (~${Math.round(v * 10) / 10}) may still exceed remaining daily (~${Math.round(cap * 10) / 10}).`,
        );
      }
    };
    check("calories", n.calories, remaining.calories);
    check("sodium", n.sodium, remaining.sodiumMg);
    check("carbs", n.carbs, remaining.carbsG);
    check("protein", n.protein, remaining.proteinG);
    check("fat", n.fat, remaining.fatG);
    check("sugars", n.sugar, remaining.sugarG);
    check("saturated fat", n.saturatedFat, remaining.saturatedFatG);
    check("cholesterol", n.cholesterol, remaining.cholesterolMg);
    return bad ? "warning" : "ok";
  }

  async listRecipes(
    userId: number,
    search?: string,
    filters?: { sourceType?: string; date?: string; mealSlot?: RecipeMealSlot; includeCommunity?: boolean },
  ) {
    const term = search?.trim();
    const includeCommunity = filters?.includeCommunity ?? false;
    let rows: RecipeEntity[];
    if (!term) {
      if (includeCommunity) {
        rows = await this.recipeRepo
          .createQueryBuilder("recipe")
          .where(RECIPE_COMMUNITY_ACCESS_WHERE, { userId })
          .andWhere("recipe.delFlag = :delFlag", { delFlag: false })
          .orderBy("recipe.createdAt", "DESC")
          .addOrderBy("recipe.id", "DESC")
          .getMany();
      } else {
        rows = await this.recipeRepo.find({
          where: { userId, delFlag: false },
          order: { createdAt: "DESC", id: "DESC" },
        });
      }
    } else {
      const q = `%${term}%`;
      const qb = this.recipeRepo
        .createQueryBuilder("recipe")
        .where("recipe.delFlag = :delFlag", { delFlag: false })
        .andWhere("(recipe.name ILIKE :q OR COALESCE(recipe.source, '') ILIKE :q)", { q });

      if (includeCommunity) {
        qb.andWhere(RECIPE_COMMUNITY_ACCESS_WHERE, { userId });
      } else {
        qb.andWhere("recipe.userId = :userId", { userId });
      }

      rows = await qb
        .orderBy("recipe.createdAt", "DESC")
        .addOrderBy("recipe.id", "DESC")
        .getMany();
    }
    const filteredRows = rows.filter((row) => {
      if (!filters?.sourceType && !filters?.date && !filters?.mealSlot) {
        return true;
      }
      const meta = this.sourceMeta(row);
      if (filters.sourceType && meta.sourceType !== filters.sourceType) {
        return false;
      }
      if (filters.date && meta.dateKey !== filters.date) {
        return false;
      }
      if (filters.mealSlot && meta.mealSlot !== filters.mealSlot) {
        return false;
      }
      return true;
    });
    return Promise.all(filteredRows.map((row) => this.getRecipeById(userId, Number(row.id))));
  }

  async getRecipeById(userId: number, recipeId: number) {
    const recipe = await this.recipeRepo
      .createQueryBuilder("recipe")
      .where("recipe.id = :recipeId", { recipeId })
      .andWhere("recipe.delFlag = :delFlag", { delFlag: false })
      .andWhere(RECIPE_COMMUNITY_ACCESS_WHERE, { userId })
      .getOne();
    if (!recipe) throw new NotFoundException("Recipe not found");

    const [ingredientRows, steps] = await Promise.all([
      this.recipeIngredientRepo.find({
        where: { recipeId },
        order: { position: "ASC" },
      }),
      this.recipeStepRepo.find({
        where: { recipeId, delFlag: false },
        order: { stepNo: "ASC" },
      }),
    ]);
    const ingredientRowsWithMeta = ingredientRows.map((row) => ({
      row,
      meta: this.safeParse(row.quantityRaw),
    }));
    const foodIds = ingredientRowsWithMeta
      .map(({ meta }) => Number(meta.foodId ?? 0))
      .filter((id) => Number.isFinite(id) && id > 0);
    const foodNameMap = new Map<number, string>();
    if (foodIds.length) {
      const foods = await this.foodRepo.find({
        where: { id: In(foodIds as any) },
      });
      for (const item of foods) {
        foodNameMap.set(Number(item.id), item.foodName);
      }
    }

    const ingredientView = ingredientRowsWithMeta.map(({ row, meta }) => {
      const foodId = meta.foodId == null ? null : Number(meta.foodId);
      return {
        id: row.position,
        foodId,
        name: foodId == null ? (meta.name ?? "") : (foodNameMap.get(foodId) ?? meta.name ?? ""),
        quantity: Number(meta.quantity ?? 0),
        unit: String(meta.unit ?? "g"),
        calories: Number(meta.calories ?? 0),
        protein: Number(meta.protein ?? 0),
        carbs: Number(meta.carbs ?? 0),
        fat: Number(meta.fat ?? 0),
        fiber: Number(meta.fiber ?? 0),
        sodium: Number(meta.sodium ?? 0),
        sugar: Number(meta.sugar ?? 0),
        saturatedFat: Number(meta.saturatedFat ?? 0),
        cholesterol: Number(meta.cholesterol ?? 0),
        potassium: Number(meta.potassium ?? 0),
        calciumMg: Number(meta.calciumMg ?? 0),
        ironMg: Number(meta.ironMg ?? 0),
        magnesiumMg: Number(meta.magnesiumMg ?? 0),
        phosphorusMg: Number(meta.phosphorusMg ?? 0),
        zincMg: Number(meta.zincMg ?? 0),
        vitaminAUg: Number(meta.vitaminAUg ?? 0),
        vitaminCMg: Number(meta.vitaminCMg ?? 0),
        vitaminDUg: Number(meta.vitaminDUg ?? 0),
        vitaminEMg: Number(meta.vitaminEMg ?? 0),
        vitaminKUg: Number(meta.vitaminKUg ?? 0),
        vitaminB6Mg: Number(meta.vitaminB6Mg ?? 0),
        vitaminB12Ug: Number(meta.vitaminB12Ug ?? 0),
        folateDfeUg: Number(meta.folateDfeUg ?? 0),
        order: Number(row.position ?? 0),
      };
    });
    const servings = Math.max(1, Number(recipe.servings ?? 1));

    const nutrition = ingredientView.reduce(
      (acc, item) => {
        const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 0;
        acc.calories += item.calories * qty;
        acc.protein += item.protein * qty;
        acc.carbs += item.carbs * qty;
        acc.fat += item.fat * qty;
        acc.fiber += item.fiber * qty;
        acc.sodium += item.sodium * qty;
        acc.sugar += item.sugar * qty;
        acc.saturatedFat += item.saturatedFat * qty;
        acc.cholesterol += item.cholesterol * qty;
        acc.potassium += item.potassium * qty;
        acc.calciumMg += item.calciumMg * qty;
        acc.ironMg += item.ironMg * qty;
        acc.magnesiumMg += item.magnesiumMg * qty;
        acc.phosphorusMg += item.phosphorusMg * qty;
        acc.zincMg += item.zincMg * qty;
        acc.vitaminAUg += item.vitaminAUg * qty;
        acc.vitaminCMg += item.vitaminCMg * qty;
        acc.vitaminDUg += item.vitaminDUg * qty;
        acc.vitaminEMg += item.vitaminEMg * qty;
        acc.vitaminKUg += item.vitaminKUg * qty;
        acc.vitaminB6Mg += item.vitaminB6Mg * qty;
        acc.vitaminB12Ug += item.vitaminB12Ug * qty;
        acc.folateDfeUg += item.folateDfeUg * qty;
        return acc;
      },
      {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        sodium: 0,
        sugar: 0,
        saturatedFat: 0,
        cholesterol: 0,
        potassium: 0,
        calciumMg: 0,
        ironMg: 0,
        magnesiumMg: 0,
        phosphorusMg: 0,
        zincMg: 0,
        vitaminAUg: 0,
        vitaminCMg: 0,
        vitaminDUg: 0,
        vitaminEMg: 0,
        vitaminKUg: 0,
        vitaminB6Mg: 0,
        vitaminB12Ug: 0,
        folateDfeUg: 0,
      },
    );
    for (const key of Object.keys(nutrition) as Array<keyof typeof nutrition>) {
      nutrition[key] = Math.round((nutrition[key] / servings) * 10) / 10;
    }

    return {
      id: Number(recipe.id),
      name: recipe.name,
      description: this.sourceMeta(recipe).description ?? null,
      imageUrl: recipe.imageUrl,
      shareWith: Number(this.sourceMeta(recipe).shareWith ?? 1),
      servings,
      prepMinutes: Number(this.sourceMeta(recipe).prepMinutes ?? 0),
      cookMinutes: Number(this.sourceMeta(recipe).cookMinutes ?? 0),
      difficulty: String(this.sourceMeta(recipe).difficulty ?? "easy"),
      tags: Array.isArray(this.sourceMeta(recipe).tags) ? this.sourceMeta(recipe).tags : [],
      nutritionPerServing: nutrition,
      sourceType: this.sourceMeta(recipe).sourceType ?? null,
      dateKey: this.sourceMeta(recipe).dateKey ?? null,
      mealSlot: this.sourceMeta(recipe).mealSlot ?? null,
      isVerified: Boolean(recipe.isVerified),
      score: this.sourceMeta(recipe).score ?? null,
      warnings: Array.isArray(this.sourceMeta(recipe).warnings) ? this.sourceMeta(recipe).warnings : [],
      recommendation: String(this.sourceMeta(recipe).recommendation ?? ""),
      safetyWarnings: Array.isArray(this.sourceMeta(recipe).safetyWarnings)
        ? this.sourceMeta(recipe).safetyWarnings.map((item: unknown) => String(item))
        : [],
      generationWarnings: Array.isArray(this.sourceMeta(recipe).generationWarnings)
        ? this.sourceMeta(recipe).generationWarnings.map((item: unknown) => String(item))
        : [],
      ingredients: ingredientView,
      steps: steps.map((step) => ({
        id: Number(step.stepNo),
        order: Number(step.stepNo ?? 1),
        instruction: step.instruction,
        duration: step.durationMinutes == null ? null : Number(step.durationMinutes),
        tips: step.tips ?? null,
      })),
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
    };
  }

  async createRecipe(userId: number, dto: CreateRecipeDto) {
    const recipe = await this.recipeRepo.save(
      this.recipeRepo.create({
        userId,
        name: dto.name.trim(),
        imageUrl: dto.imageUrl?.trim() || null,
        servings: dto.servings,
        isVerified: false,
        source: JSON.stringify({
          description: dto.description ?? null,
          shareWith: dto.shareWith ?? 1,
          prepMinutes: dto.prepMinutes,
          cookMinutes: dto.cookMinutes,
          difficulty: dto.difficulty,
          tags: dto.tags ?? [],
          ...this.sourceFieldsFromCreateDto(dto),
        }),
        delFlag: false,
      }),
    );
    const recipeId = Number(recipe.id);
    await this.replaceRecipeChildren(recipeId, dto);
    return this.getRecipeById(userId, recipeId);
  }

  async createGeneratedRecipe(
    userId: number,
    recipe: Recipe,
    sourceMeta: Record<string, unknown>,
  ) {
    const dto = this.toCreateRecipeDto(recipe);
    const saved = await this.recipeRepo.save(
      this.recipeRepo.create({
        userId,
        name: dto.name.trim(),
        imageUrl: dto.imageUrl?.trim() || null,
        servings: dto.servings,
        isVerified: false,
        source: JSON.stringify({
          description: dto.description ?? null,
          shareWith: dto.shareWith ?? 1,
          prepMinutes: dto.prepMinutes,
          cookMinutes: dto.cookMinutes,
          difficulty: dto.difficulty,
          tags: dto.tags ?? [],
          ...sourceMeta,
        }),
        delFlag: false,
      }),
    );
    const recipeId = Number(saved.id);
    await this.replaceRecipeChildren(recipeId, dto);
    return this.getRecipeById(userId, recipeId);
  }

  async findGeneratedRecipe(
    userId: number,
    dateKey: string,
    mealSlot: RecipeMealSlot,
    sourceType = "fridge_ai_daily_plan",
  ) {
    const rows = await this.recipeRepo.find({
      where: { userId, delFlag: false },
      order: { createdAt: "DESC", id: "DESC" },
    });
    for (const row of rows) {
      const meta = this.sourceMeta(row);
      if (
        meta.sourceType === sourceType &&
        meta.dateKey === dateKey &&
        meta.mealSlot === mealSlot
      ) {
        return this.getRecipeById(userId, Number(row.id));
      }
    }
    return null;
  }

  async softDeleteGeneratedRecipeSlot(
    userId: number,
    dateKey: string,
    mealSlot: RecipeMealSlot,
    sourceType = "fridge_ai_daily_plan",
  ): Promise<void> {
    const rows = await this.recipeRepo.find({
      where: { userId, delFlag: false },
      order: { createdAt: "DESC", id: "DESC" },
    });
    for (const row of rows) {
      const meta = this.sourceMeta(row);
      if (
        meta.sourceType === sourceType &&
        meta.dateKey === dateKey &&
        meta.mealSlot === mealSlot
      ) {
        row.delFlag = true;
        await this.recipeRepo.save(row);
      }
    }
  }

  async updateRecipe(userId: number, recipeId: number, dto: UpdateRecipeDto) {
    const row = await this.recipeRepo.findOne({ where: { id: recipeId, userId, delFlag: false } });
    if (!row) throw new NotFoundException("Recipe not found");
    const prevMeta = this.sourceMeta(row);
    row.name = dto.name.trim();
    row.imageUrl = dto.imageUrl?.trim() || null;
    row.servings = dto.servings;
    row.source = JSON.stringify({
      description: dto.description ?? null,
      shareWith: dto.shareWith ?? 1,
      prepMinutes: dto.prepMinutes,
      cookMinutes: dto.cookMinutes,
      difficulty: dto.difficulty,
      tags: dto.tags ?? [],
      sourceType: prevMeta.sourceType ?? null,
      dateKey: prevMeta.dateKey ?? null,
      mealSlot: prevMeta.mealSlot ?? null,
      score: dto.score != null ? dto.score : (prevMeta.score ?? null),
      warnings:
        dto.warnings != null
          ? dto.warnings
          : Array.isArray(prevMeta.warnings)
            ? prevMeta.warnings
            : [],
    });
    await this.recipeRepo.save(row);
    await this.replaceRecipeChildren(recipeId, dto);
    return this.getRecipeById(userId, recipeId);
  }

  async deleteRecipe(userId: number, recipeId: number) {
    const row = await this.recipeRepo.findOne({ where: { id: recipeId, userId, delFlag: false } });
    if (!row) throw new NotFoundException("Recipe not found");
    row.delFlag = true;
    await this.recipeRepo.save(row);
    return { message: "OK", statusCode: 200 };
  }

  async convertToMeal(userId: number, recipeId: number) {
    const recipe = await this.getRecipeById(userId, recipeId);
    const directions = recipe.description?.trim() || "";

    const meal = await this.mealsService.create(userId, {
      name: `Recipe: ${recipe.name}`,
      directions,
      shareWith: recipe.shareWith ?? 1,
      imageUrl: recipe.imageUrl ?? undefined,
    });

    const mealId = Number(meal.id);
    for (const ingredient of recipe.ingredients as any[]) {
      const foodId = Number(ingredient.foodId ?? 0);
      if (!Number.isFinite(foodId) || foodId <= 0) continue;
      await this.mealsService.addItem(userId, mealId, {
        foodId,
        quantity: Number(ingredient.quantity ?? 1) || 1,
        unit: ingredient.unit ?? undefined,
      });
    }
    return this.mealsService.getById(userId, mealId);
  }

  private async replaceRecipeChildren(
    recipeId: number,
    dto: { ingredients: any[]; steps: any[] },
  ) {
    await this.recipeIngredientRepo.delete({ recipeId });
    await this.recipeStepRepo.delete({ recipeId });

    if (dto.ingredients.length) {
      await this.recipeIngredientRepo.save(
        dto.ingredients.map((item, idx) =>
          this.recipeIngredientRepo.create({
            recipeId,
            position: idx + 1,
            quantityRaw: JSON.stringify({
              foodId: item.foodId ?? null,
              name: item.name.trim(),
              quantity: this.nonNegativeNumber(item.quantity),
              unit: item.unit,
              calories: this.nonNegativeNumber(item.calories),
              protein: this.nonNegativeNumber(item.protein),
              carbs: this.nonNegativeNumber(item.carbs),
              fat: this.nonNegativeNumber(item.fat),
              fiber: this.nonNegativeNumber(item.fiber),
              sodium: this.nonNegativeNumber(item.sodium),
              sugar: this.nonNegativeNumber(item.sugar),
              saturatedFat: this.nonNegativeNumber(item.saturatedFat),
              cholesterol: this.nonNegativeNumber(item.cholesterol),
              potassium: this.nonNegativeNumber(item.potassium),
              calciumMg: this.nonNegativeNumber(item.calciumMg),
              ironMg: this.nonNegativeNumber(item.ironMg),
              magnesiumMg: this.nonNegativeNumber(item.magnesiumMg),
              phosphorusMg: this.nonNegativeNumber(item.phosphorusMg),
              zincMg: this.nonNegativeNumber(item.zincMg),
              vitaminAUg: this.nonNegativeNumber(item.vitaminAUg),
              vitaminCMg: this.nonNegativeNumber(item.vitaminCMg),
              vitaminDUg: this.nonNegativeNumber(item.vitaminDUg),
              vitaminEMg: this.nonNegativeNumber(item.vitaminEMg),
              vitaminKUg: this.nonNegativeNumber(item.vitaminKUg),
              vitaminB6Mg: this.nonNegativeNumber(item.vitaminB6Mg),
              vitaminB12Ug: this.nonNegativeNumber(item.vitaminB12Ug),
              folateDfeUg: this.nonNegativeNumber(item.folateDfeUg),
            }),
          }),
        ),
      );
    }
    if (dto.steps.length) {
      await this.recipeStepRepo.save(
        dto.steps.map((step, idx) =>
          this.recipeStepRepo.create({
            recipeId,
            stepNo: this.positiveInteger(step.order, idx + 1),
            instruction: String(step.instruction ?? "").trim(),
            durationMinutes: this.nullableNonNegativeInteger(step.duration),
            tips: step.tips == null ? null : String(step.tips).trim() || null,
            delFlag: false,
          }),
        ),
      );
    }
  }

  private sourceFieldsFromCreateDto(dto: CreateRecipeDto): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    const sourceType = String(dto.sourceType ?? "").trim();
    if (sourceType) fields.sourceType = sourceType;
    const dateKey = String(dto.dateKey ?? "").trim();
    if (dateKey) fields.dateKey = dateKey;
    if (dto.mealSlot) fields.mealSlot = dto.mealSlot;
    if (dto.score != null) fields.score = dto.score;
    if (dto.warnings != null) fields.warnings = dto.warnings;
    return fields;
  }

  private sourceMeta(recipe: RecipeEntity): Record<string, any> {
    return this.safeParse(recipe.source);
  }

  private toCreateRecipeDto(recipe: Recipe): CreateRecipeDto {
    const difficulty = ["easy", "medium", "hard"].includes(recipe.difficulty)
      ? recipe.difficulty
      : "easy";
    return {
      name: String(recipe.name || "AI Fridge Recipe").trim(),
      description: String(recipe.description || "").trim(),
      servings: this.positiveInteger(recipe.servings, 1),
      prepMinutes: this.positiveInteger(recipe.preparationTime, 0),
      cookMinutes: this.positiveInteger(recipe.cookingTime, 0),
      difficulty,
      shareWith: 1,
      tags: ["AI Fridge Plan"],
      ingredients: (recipe.ingredients || []).map((item) => ({
        foodId: item.foodId,
        name: String(item.name || "Ingredient").trim(),
        quantity: this.nonNegativeNumber(item.amount),
        unit: String(item.unit || "serving"),
        calories: this.nonNegativeNumber((item as any).calories),
        protein: this.nonNegativeNumber((item as any).protein),
        carbs: this.nonNegativeNumber((item as any).carbs),
        fat: this.nonNegativeNumber((item as any).fat),
        fiber: this.nonNegativeNumber((item as any).fiber),
        sodium: this.nonNegativeNumber((item as any).sodium),
        sugar: this.nonNegativeNumber((item as any).sugar),
        saturatedFat: this.nonNegativeNumber((item as any).saturatedFat),
        cholesterol: this.nonNegativeNumber((item as any).cholesterol),
        potassium: this.nonNegativeNumber((item as any).potassium),
        calciumMg: this.nonNegativeNumber((item as any).calciumMg),
        ironMg: this.nonNegativeNumber((item as any).ironMg),
        magnesiumMg: this.nonNegativeNumber((item as any).magnesiumMg),
        phosphorusMg: this.nonNegativeNumber((item as any).phosphorusMg),
        zincMg: this.nonNegativeNumber((item as any).zincMg),
        vitaminAUg: this.nonNegativeNumber((item as any).vitaminAUg),
        vitaminCMg: this.nonNegativeNumber((item as any).vitaminCMg),
        vitaminDUg: this.nonNegativeNumber((item as any).vitaminDUg),
        vitaminEMg: this.nonNegativeNumber((item as any).vitaminEMg),
        vitaminKUg: this.nonNegativeNumber((item as any).vitaminKUg),
        vitaminB6Mg: this.nonNegativeNumber((item as any).vitaminB6Mg),
        vitaminB12Ug: this.nonNegativeNumber((item as any).vitaminB12Ug),
        folateDfeUg: this.nonNegativeNumber((item as any).folateDfeUg),
      })),
      steps: (recipe.steps || []).map((step, idx) => ({
        order: this.positiveInteger(step.order, idx + 1),
        instruction: String(step.instruction || "").trim() || "Prepare and combine the ingredients.",
        duration: this.nullableNonNegativeInteger(step.duration) ?? undefined,
        tips: step.tips,
      })),
      nutritionPerServing: recipe.nutritionPerServing,
    };
  }

  private safeParse(value: string | null | undefined): Record<string, any> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private parseRecipeAiResponse(recipeJson: string): {
    recipe: Recipe;
    alternativeRecipes?: Recipe[];
    recommendation?: string;
  } {
    try {
      const jsonMatch = recipeJson.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON object found");
      }
      const parsed = JSON.parse(jsonMatch[0]) as {
        recipe?: Recipe;
        alternativeRecipes?: Recipe[];
        recommendation?: string;
      };
      if (!parsed.recipe || typeof parsed.recipe !== "object") {
        throw new Error("Missing recipe object");
      }
      return {
        recipe: parsed.recipe,
        alternativeRecipes: parsed.alternativeRecipes,
        recommendation: parsed.recommendation,
      };
    } catch (error) {
      this.logger.warn(`Recipe AI returned invalid JSON: ${(error as Error).message}`);
      throw new BadGatewayException({
        errorKey: "recipeBuilder.errors.invalidAiResponse",
        message: "Recipe AI returned an invalid response. Please try again.",
      });
    }
  }

  private async enrichRecipeWithRealNutrition(recipe: Recipe): Promise<Recipe> {
    if (!recipe || !recipe.ingredients) return recipe;

    // Batch load all foods in a single query
    const uniqueFoodIds = [
      ...new Set(
        recipe.ingredients
          .map(ing => Number((ing as any).foodId))
          .filter(id => Number.isFinite(id) && id > 0),
      ),
    ];

    const batchFoods = uniqueFoodIds.length > 0
      ? await this.foodRepo.find({ where: { id: In(uniqueFoodIds as any) } })
      : [];
    const foodMap = new Map(batchFoods.map(f => [Number(f.id), f]));

    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let totalSodium = 0;
    let totalFiber = 0;
    let totalSugar = 0;
    let totalSaturatedFat = 0;
    let totalCholesterol = 0;
    let totalPotassium = 0;
    let totalCalcium = 0;
    let totalIron = 0;
    let totalMagnesium = 0;
    let totalPhosphorus = 0;
    let totalZinc = 0;
    let totalVitaminA = 0;
    let totalVitaminC = 0;
    let totalVitaminD = 0;
    let totalVitaminE = 0;
    let totalVitaminK = 0;
    let totalVitaminB6 = 0;
    let totalVitaminB12 = 0;
    let totalFolateDfe = 0;

    const servings = Math.max(1, Number(recipe.servings || 1));

    for (const ingredient of recipe.ingredients) {
      const fid = Number((ingredient as any).foodId);
      let food: FoodNutritionEntity | null = null;
      if (Number.isFinite(fid) && fid > 0) {
        food = foodMap.get(fid) ?? null;
      }
      if (!food) {
        food = await this.foodService.searchFood(ingredient.name);
      }
      if (food) {
        const serv = food.servingSize > 0 ? food.servingSize : 100;
        const rawSg = (ingredient as any).servingSizeG;
        if (!Number.isFinite(Number(rawSg)) || Number(rawSg) <= 0) {
          (ingredient as any).servingSizeG = serv;
        }
        let amountG = Number(ingredient.amount_g);
        const unit = String(ingredient.unit ?? "").trim().toLowerCase();
        if ((!Number.isFinite(amountG) || amountG <= 0) && ["g", "gram", "grams"].includes(unit)) {
          amountG = Number(ingredient.amount);
        }
        if ((!Number.isFinite(amountG) || amountG <= 0) && Number.isFinite(fid) && fid > 0) {
          const amount = Number(ingredient.amount);
          amountG = Number.isFinite(amount) && amount > 0 ? amount * serv : NaN;
        }
        if (!Number.isFinite(amountG) || amountG <= 0) {
          continue;
        }
        const ratio = amountG / serv;

        // Per-ingredient reference macros (per DB serving), for API clients / recipe editor hydration.
        (ingredient as any).calories = Number(food.calories ?? 0);
        (ingredient as any).protein = Number(food.protein ?? 0);
        (ingredient as any).carbs = Number(food.carbs ?? 0);
        (ingredient as any).fat = Number(food.fat ?? 0);
        (ingredient as any).sodium = Number(food.sodium ?? 0);
        (ingredient as any).fiber = Number(food.fiber ?? 0);
        (ingredient as any).sugar = Number(food.sugars ?? 0);
        (ingredient as any).saturatedFat = Number(food.saturatedFat ?? 0);
        (ingredient as any).cholesterol = Number(food.cholesterol ?? 0);
        (ingredient as any).potassium = Number(food.potassium ?? 0);
        (ingredient as any).calciumMg = Number(food.calcium ?? 0);
        (ingredient as any).ironMg = Number(food.iron ?? 0);
        (ingredient as any).magnesiumMg = Number(food.magnesium ?? 0);
        (ingredient as any).phosphorusMg = Number(food.phosphorus ?? 0);
        (ingredient as any).zincMg = Number(food.zinc ?? 0);
        (ingredient as any).vitaminAUg = Number(food.vitaminA ?? 0);
        (ingredient as any).vitaminCMg = Number(food.vitaminC ?? 0);
        (ingredient as any).vitaminDUg = Number(food.vitaminD ?? 0);
        (ingredient as any).vitaminEMg = Number(food.vitaminE ?? 0);
        (ingredient as any).vitaminKUg = Number(food.vitaminK ?? 0);
        (ingredient as any).vitaminB6Mg = Number(food.vitaminB6 ?? 0);
        (ingredient as any).vitaminB12Ug = Number(food.vitaminB12 ?? 0);
        (ingredient as any).folateDfeUg = Number(food.folateDfe ?? 0);

        totalCalories += (food.calories || 0) * ratio;
        totalProtein += (food.protein || 0) * ratio;
        totalCarbs += (food.carbs || 0) * ratio;
        totalFat += (food.fat || 0) * ratio;
        totalSodium += (food.sodium || 0) * ratio;
        totalFiber += (food.fiber || 0) * ratio;
        totalSugar += (food.sugars || 0) * ratio;
        totalSaturatedFat += (food.saturatedFat || 0) * ratio;
        totalCholesterol += (food.cholesterol || 0) * ratio;
        totalPotassium += (food.potassium || 0) * ratio;
        totalCalcium += (food.calcium || 0) * ratio;
        totalIron += (food.iron || 0) * ratio;
        totalMagnesium += (food.magnesium || 0) * ratio;
        totalPhosphorus += (food.phosphorus || 0) * ratio;
        totalZinc += (food.zinc || 0) * ratio;
        totalVitaminA += (food.vitaminA || 0) * ratio;
        totalVitaminC += (food.vitaminC || 0) * ratio;
        totalVitaminD += (food.vitaminD || 0) * ratio;
        totalVitaminE += (food.vitaminE || 0) * ratio;
        totalVitaminK += (food.vitaminK || 0) * ratio;
        totalVitaminB6 += (food.vitaminB6 || 0) * ratio;
        totalVitaminB12 += (food.vitaminB12 || 0) * ratio;
        totalFolateDfe += (food.folateDfe || 0) * ratio;
      }
    }

    // Update the recipe with re-calculated values (per serving)
    recipe.nutritionPerServing = {
      calories: Math.round(totalCalories / servings),
      protein: Math.round(totalProtein / servings),
      carbs: Math.round(totalCarbs / servings),
      fat: Math.round(totalFat / servings),
      sodium: Math.round(totalSodium / servings),
      fiber: Math.round(totalFiber / servings) || recipe.nutritionPerServing?.fiber || 0,
      sugar: Math.round(totalSugar / servings),
      saturatedFat: Math.round(totalSaturatedFat / servings),
      cholesterol: Math.round(totalCholesterol / servings),
      potassium: Math.round(totalPotassium / servings),
      calciumMg: Math.round(totalCalcium / servings),
      ironMg: Math.round((totalIron / servings) * 10) / 10,
      magnesiumMg: Math.round(totalMagnesium / servings),
      phosphorusMg: Math.round(totalPhosphorus / servings),
      zincMg: Math.round((totalZinc / servings) * 10) / 10,
      vitaminAUg: Math.round(totalVitaminA / servings),
      vitaminCMg: Math.round((totalVitaminC / servings) * 10) / 10,
      vitaminDUg: Math.round((totalVitaminD / servings) * 10) / 10,
      vitaminEMg: Math.round((totalVitaminE / servings) * 10) / 10,
      vitaminKUg: Math.round((totalVitaminK / servings) * 10) / 10,
      vitaminB6Mg: Math.round((totalVitaminB6 / servings) * 10) / 10,
      vitaminB12Ug: Math.round((totalVitaminB12 / servings) * 10) / 10,
      folateDfeUg: Math.round(totalFolateDfe / servings),
    };

    return recipe;
  }

  private validateNutritionAgainstThresholds(
    recipe: Recipe,
    context: UserMealContext | null,
    mealSlot?: RecipeMealSlot,
  ): string[] {
    const warnings: string[] = [];
    if (!recipe || !recipe.nutritionPerServing || !context || context.thresholds.length === 0) {
      return warnings;
    }

    const nutrition = recipe.nutritionPerServing;
    for (const t of context.thresholds) {
      const nutrient = t.nutrient.toLowerCase();
      const sodium = nutrition.sodium ?? 0;
      const carbs = nutrition.carbs ?? 0;
      const calories = nutrition.calories ?? 0;
      const sugar = nutrition.sugar ?? 0;
      const saturatedFat = nutrition.saturatedFat ?? 0;
      const cholesterol = nutrition.cholesterol ?? 0;
      const potassium = nutrition.potassium ?? 0;
      const warnLimit = (label: string, value: number, unit: string, limit: number) => {
        warnings.push(`Caution: Recipe ${label} (${value}${unit}) exceeds your limit of ${limit}${unit}.`);
      };
      if (nutrient === "saturatedfat" && t.maxAmount && saturatedFat > t.maxAmount) {
        warnLimit("saturated fat", saturatedFat, "g", t.maxAmount);
      }
      if (nutrient === "cholesterol" && t.maxAmount && cholesterol > t.maxAmount) {
        warnLimit("cholesterol", cholesterol, "mg", t.maxAmount);
      }
      if (nutrient === "potassium" && t.minAmount) {
        // A daily minimum is met across the day: judge one serving against this
        // meal's share of it, not the whole day's amount.
        const share = mealSlot ? MEAL_SPLITS[mealSlot] : 1;
        const needed = Math.round(Number(t.minAmount) * share);
        if (potassium < needed) {
          const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
          warnings.push(
            mealSlot
              ? `Potassium is low for this ${mealSlot}: ${fmt(potassium)} mg vs about ${fmt(needed)} mg ` +
                  `(${Math.round(share * 100)}% of your ${fmt(Number(t.minAmount))} mg daily target).`
              : `Potassium is low: ${fmt(potassium)} mg vs your ${fmt(needed)} mg daily target.`,
          );
        }
      }
      if (nutrient === "sodium" && t.maxAmount && sodium > t.maxAmount) {
        warnings.push(`⚠️ Caution: Recipe sodium (${sodium}mg) exceeds your custom limit of ${t.maxAmount}mg.`);
      }
      if (nutrient === "carbs" && t.maxAmount && carbs > t.maxAmount) {
        warnings.push(`⚠️ Caution: Recipe carbs (${carbs}g) exceeds your custom limit of ${t.maxAmount}g.`);
      }
      if (nutrient === "sugars" && t.maxAmount && sugar > t.maxAmount) {
        warnLimit("sugars", sugar, "g", t.maxAmount);
      }
      if (nutrient === "calories" && t.maxAmount && calories > t.maxAmount) {
        warnings.push(`⚠️ Caution: Recipe calories (${calories}kcal) exceeds your limit of ${t.maxAmount}kcal.`);
      }
    }
    return warnings;
  }
}
