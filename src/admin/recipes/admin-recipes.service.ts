import { HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { FoodNutritionEntity } from "../../meal-planning/entities/food-nutrition.entity";
import { RecipeEntity } from "../../recipe-builder/entities/recipe.entity";
import { RecipeIngredientEntity } from "../../recipe-builder/entities/recipe-ingredient.entity";
import { RecipeStepEntity } from "../../recipe-builder/entities/recipe-step.entity";
import { AdminRecipeException } from "./admin-recipes.exception";
import { AdminRecipeListQueryDto, AdminRecipeSortBy } from "./dto/admin-recipe-list-query.dto";
import {
  AdminRecipeDeleteResponseDto,
  AdminRecipeDetailEnvelopeDto,
  AdminRecipeDetailResponseDto,
  AdminRecipeListResponseDto,
  AdminRecipeResponseDto,
  AdminRecipeVerifyResponseDto,
  AdminRecipeWriteResponseDto,
} from "./dto/admin-recipe-response.dto";
import {
  AdminRecipeIngredientRequestDto,
  AdminRecipeStepRequestDto,
  CreateAdminRecipeRequestDto,
  UpdateAdminRecipeRequestDto,
  UpdateRecipeVerifyRequestDto,
} from "./dto/write-admin-recipe-request.dto";

type RecipeSortableColumn = "recipe.name" | "recipe.userId" | "recipe.servings" | "recipe.createdAt" | "recipe.updatedAt";
type JsonRecord = Record<string, unknown>;

const SORT_COLUMN_MAP: Record<AdminRecipeSortBy, RecipeSortableColumn> = {
  title: "recipe.name",
  userId: "recipe.userId",
  servings: "recipe.servings",
  createdAt: "recipe.createdAt",
  updatedAt: "recipe.updatedAt",
};

@Injectable()
export class AdminRecipesService {
  constructor(
    @InjectRepository(RecipeEntity)
    private readonly recipeRepo: Repository<RecipeEntity>,
    @InjectRepository(RecipeIngredientEntity)
    private readonly recipeIngredientRepo: Repository<RecipeIngredientEntity>,
    @InjectRepository(RecipeStepEntity)
    private readonly recipeStepRepo: Repository<RecipeStepEntity>,
    @InjectRepository(FoodNutritionEntity)
    private readonly foodRepo: Repository<FoodNutritionEntity>,
  ) {}

  async list(query: AdminRecipeListQueryDto): Promise<AdminRecipeListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? "createdAt";
    const sortOrder = (query.sortOrder ?? "desc").toUpperCase() as "ASC" | "DESC";
    const qb = this.recipeRepo
      .createQueryBuilder("recipe")
      .where("recipe.delFlag = :delFlag", { delFlag: false });

    if (query.keyword?.trim()) {
      qb.andWhere("(recipe.name ILIKE :keyword OR COALESCE(recipe.source, '') ILIKE :keyword)", {
        keyword: `%${query.keyword.trim()}%`,
      });
    }

    if (query.userId !== undefined) {
      qb.andWhere("recipe.userId = :userId", { userId: query.userId });
    }

    if (query.isVerified !== undefined) {
      qb.andWhere("recipe.isVerified = :isVerified", { isVerified: query.isVerified });
    }

    const [totalBeforeSourceFilter, rowsBeforeSourceFilter] = await Promise.all([
      qb.clone().getCount(),
      qb
        .clone()
        .orderBy(SORT_COLUMN_MAP[sortBy], sortOrder)
        .addOrderBy("recipe.id", "DESC")
        .getMany(),
    ]);

    const filteredRows = query.sourceType?.trim()
      ? rowsBeforeSourceFilter.filter((recipe) => this.textField(this.sourceMeta(recipe).sourceType) === query.sourceType?.trim())
      : rowsBeforeSourceFilter;
    const total = query.sourceType?.trim() ? filteredRows.length : totalBeforeSourceFilter;
    const rows = filteredRows.slice((page - 1) * limit, page * limit);

    return {
      success: true,
      data: rows.map((recipe) => this.toListItem(recipe)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async detail(id: number): Promise<AdminRecipeDetailEnvelopeDto> {
    const recipe = await this.findActiveRecipeOrThrow(id);
    return {
      success: true,
      data: await this.toDetail(recipe),
    };
  }

  async create(dto: CreateAdminRecipeRequestDto): Promise<AdminRecipeWriteResponseDto> {
    const title = this.normalizeRequiredText(dto.title);
    await this.assertRecipeTitleAvailable(dto.userId, title);

    const saved = await this.recipeRepo.save(
      this.recipeRepo.create({
        userId: dto.userId,
        name: title,
        imageUrl: this.normalizeOptionalText(dto.imageUrl ?? undefined),
        servings: dto.servings,
        source: JSON.stringify(this.toSourceMeta(dto)),
        isVerified: dto.isVerified ?? true,
        delFlag: false,
      }),
    );

    await this.replaceRecipeChildren(Number(saved.id), dto.ingredients, dto.steps);

    return {
      success: true,
      message: "Recipe created successfully",
      data: {
        id: Number(saved.id),
        title: saved.name,
      },
    };
  }

  async update(id: number, dto: UpdateAdminRecipeRequestDto): Promise<AdminRecipeWriteResponseDto> {
    const recipe = await this.findActiveRecipeOrThrow(id);
    const title = this.normalizeRequiredText(dto.title);
    const nextUserId = dto.userId;

    if (title.toLowerCase() !== recipe.name.toLowerCase() || Number(recipe.userId) !== nextUserId) {
      await this.assertRecipeTitleAvailable(nextUserId, title, id);
    }

    const previousMeta = this.sourceMeta(recipe);
    recipe.userId = nextUserId;
    recipe.name = title;
    recipe.imageUrl = this.normalizeOptionalText(dto.imageUrl ?? undefined);
    recipe.servings = dto.servings;
    recipe.isVerified = dto.isVerified ?? recipe.isVerified;
    recipe.source = JSON.stringify({
      ...previousMeta,
      ...this.toSourceMeta(dto),
    });
    recipe.updatedAt = new Date();

    const saved = await this.recipeRepo.save(recipe);
    await this.replaceRecipeChildren(id, dto.ingredients, dto.steps);

    return {
      success: true,
      message: "Recipe updated successfully",
      data: {
        id: Number(saved.id),
        title: saved.name,
      },
    };
  }

  async softDelete(id: number): Promise<AdminRecipeDeleteResponseDto> {
    const recipe = await this.findActiveRecipeOrThrow(id);
    recipe.delFlag = true;
    recipe.updatedAt = new Date();
    await this.recipeRepo.save(recipe);

    return {
      success: true,
      message: "Recipe deleted successfully",
    };
  }

  async updateVerify(id: number, dto: UpdateRecipeVerifyRequestDto): Promise<AdminRecipeVerifyResponseDto> {
    const recipe = await this.findActiveRecipeOrThrow(id);
    recipe.isVerified = dto.isVerified;
    recipe.updatedAt = new Date();
    const saved = await this.recipeRepo.save(recipe);

    return {
      success: true,
      message: "Recipe verification status updated successfully",
      data: {
        id: Number(saved.id),
        isVerified: saved.isVerified,
      },
    };
  }

  private async findActiveRecipeOrThrow(id: number): Promise<RecipeEntity> {
    const recipe = await this.recipeRepo.findOne({ where: { id, delFlag: false } });
    if (!recipe) {
      throw new AdminRecipeException("RECIPE_NOT_FOUND", HttpStatus.NOT_FOUND);
    }
    return recipe;
  }

  private async assertRecipeTitleAvailable(userId: number, title: string, excludeId?: number): Promise<void> {
    const qb = this.recipeRepo
      .createQueryBuilder("recipe")
      .where("recipe.delFlag = :delFlag", { delFlag: false })
      .andWhere("recipe.userId = :userId", { userId })
      .andWhere("lower(recipe.name) = :title", { title: title.toLowerCase() });

    if (excludeId !== undefined) {
      qb.andWhere("recipe.id != :excludeId", { excludeId });
    }

    const existing = await qb.getOne();
    if (existing) {
      throw new AdminRecipeException("RECIPE_TITLE_ALREADY_EXISTS", HttpStatus.CONFLICT);
    }
  }

  private async toDetail(recipe: RecipeEntity): Promise<AdminRecipeDetailResponseDto> {
    const [ingredientRows, stepRows] = await Promise.all([
      this.recipeIngredientRepo.find({
        where: { recipeId: Number(recipe.id) },
        order: { position: "ASC" },
      }),
      this.recipeStepRepo.find({
        where: { recipeId: Number(recipe.id), delFlag: false },
        order: { stepNo: "ASC" },
      }),
    ]);

    return {
      ...this.toListItem(recipe),
      ingredients: ingredientRows.map((row) => {
        const meta = this.safeParse(row.quantityRaw);
        return {
          position: Number(row.position),
          foodId: this.optionalNumber(meta.foodId),
          name: this.textField(meta.name),
          quantity: this.numberField(meta.quantity),
          unit: this.textField(meta.unit) || "g",
          calories: this.numberField(meta.calories),
          protein: this.numberField(meta.protein),
          carbs: this.numberField(meta.carbs),
          fat: this.numberField(meta.fat),
        };
      }),
      steps: stepRows.map((step) => ({
        order: Number(step.stepNo),
        instruction: step.instruction,
        duration: step.durationMinutes == null ? null : Number(step.durationMinutes),
        tips: step.tips,
      })),
      sourceMeta: this.sourceMeta(recipe),
    };
  }

  private toListItem(recipe: RecipeEntity): AdminRecipeResponseDto {
    const meta = this.sourceMeta(recipe);
    const difficulty = this.textField(meta.difficulty);
    return {
      id: Number(recipe.id),
      userId: Number(recipe.userId),
      title: recipe.name,
      imageUrl: recipe.imageUrl,
      servings: Number(recipe.servings ?? 1),
      description: this.nullableTextField(meta.description),
      shareWith: this.numberField(meta.shareWith, 1),
      prepMinutes: this.numberField(meta.prepMinutes),
      cookMinutes: this.numberField(meta.cookMinutes),
      difficulty: difficulty === "medium" || difficulty === "hard" ? difficulty : "easy",
      tags: Array.isArray(meta.tags) ? meta.tags.filter((tag): tag is string => typeof tag === "string") : [],
      sourceType: this.nullableTextField(meta.sourceType),
      dateKey: this.nullableTextField(meta.dateKey),
      mealSlot: this.nullableTextField(meta.mealSlot),
      isVerified: recipe.isVerified,
      createdAt: recipe.createdAt.toISOString(),
      updatedAt: recipe.updatedAt.toISOString(),
    };
  }

  private async replaceRecipeChildren(
    recipeId: number,
    ingredients: AdminRecipeIngredientRequestDto[],
    steps: AdminRecipeStepRequestDto[],
  ): Promise<void> {
    const foodsById = await this.loadIngredientFoods(ingredients);

    await Promise.all([
      this.recipeIngredientRepo.delete({ recipeId }),
      this.recipeStepRepo.delete({ recipeId }),
    ]);

    if (ingredients.length) {
      await this.recipeIngredientRepo.save(
        ingredients.map((item, index) => {
          const food = foodsById.get(item.foodId);
          if (!food) {
            throw new AdminRecipeException("INGREDIENT_FOOD_NOT_FOUND", HttpStatus.BAD_REQUEST);
          }
          return this.recipeIngredientRepo.create({
            recipeId,
            position: index + 1,
            quantityRaw: JSON.stringify({
              foodId: Number(food.id),
              name: food.foodName,
              quantity: this.nonNegativeNumber(item.quantity),
              unit: food.servingUnit || "g",
              calories: this.nonNegativeNumber(food.calories),
              protein: this.nonNegativeNumber(food.protein),
              carbs: this.nonNegativeNumber(food.carbs),
              fat: this.nonNegativeNumber(food.fat),
              fiber: this.nonNegativeNumber(food.fiber),
              sodium: this.nonNegativeNumber(food.sodium),
              sugar: this.nonNegativeNumber(food.sugars),
              saturatedFat: this.nonNegativeNumber(food.saturatedFat),
              cholesterol: this.nonNegativeNumber(food.cholesterol),
              potassium: this.nonNegativeNumber(food.potassium),
              calciumMg: this.nonNegativeNumber(food.calcium),
              ironMg: this.nonNegativeNumber(food.iron),
              magnesiumMg: this.nonNegativeNumber(food.magnesium),
              phosphorusMg: this.nonNegativeNumber(food.phosphorus),
              zincMg: this.nonNegativeNumber(food.zinc),
              vitaminAUg: this.nonNegativeNumber(food.vitaminA),
              vitaminCMg: this.nonNegativeNumber(food.vitaminC),
              vitaminDUg: this.nonNegativeNumber(food.vitaminD),
              vitaminEMg: this.nonNegativeNumber(food.vitaminE),
              vitaminKUg: this.nonNegativeNumber(food.vitaminK),
              vitaminB6Mg: this.nonNegativeNumber(food.vitaminB6),
              vitaminB12Ug: this.nonNegativeNumber(food.vitaminB12),
              folateDfeUg: this.nonNegativeNumber(food.folateDfe),
            }),
          });
        }),
      );
    }

    if (steps.length) {
      await this.recipeStepRepo.save(
        steps.map((step, index) =>
          this.recipeStepRepo.create({
            recipeId,
            stepNo: this.positiveInteger(step.order, index + 1),
            instruction: this.normalizeRequiredText(step.instruction),
            durationMinutes: step.duration == null ? null : this.nonNegativeInteger(step.duration),
            tips: this.normalizeOptionalText(step.tips ?? undefined),
            delFlag: false,
          }),
        ),
      );
    }
  }

  private async loadIngredientFoods(
    ingredients: AdminRecipeIngredientRequestDto[],
  ): Promise<Map<number, FoodNutritionEntity>> {
    const foodIds = [...new Set(ingredients.map((item) => Number(item.foodId)))];
    if (!foodIds.length) {
      return new Map();
    }

    const foods = await this.foodRepo.find({
      where: { id: In(foodIds), delFlag: false },
    });
    const foodsById = new Map(foods.map((food) => [Number(food.id), food]));
    if (foodsById.size !== foodIds.length) {
      throw new AdminRecipeException("INGREDIENT_FOOD_NOT_FOUND", HttpStatus.BAD_REQUEST);
    }
    return foodsById;
  }

  private toSourceMeta(dto: CreateAdminRecipeRequestDto | UpdateAdminRecipeRequestDto): JsonRecord {
    return {
      description: this.normalizeOptionalText(dto.description ?? undefined),
      shareWith: dto.shareWith ?? 1,
      prepMinutes: dto.prepMinutes,
      cookMinutes: dto.cookMinutes,
      difficulty: dto.difficulty,
      tags: (dto.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0),
      sourceType: this.normalizeOptionalText(dto.sourceType ?? undefined) ?? "admin",
    };
  }

  private sourceMeta(recipe: RecipeEntity): JsonRecord {
    return this.safeParse(recipe.source);
  }

  private safeParse(value: string | null | undefined): JsonRecord {
    if (!value) return {};
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as JsonRecord
        : {};
    } catch {
      return {};
    }
  }

  private normalizeRequiredText(value: string): string {
    return String(value || "").trim();
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    const normalized = String(value || "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private nullableTextField(value: unknown): string | null {
    const normalized = this.textField(value);
    return normalized.length > 0 ? normalized : null;
  }

  private textField(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  private numberField(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private optionalNumber(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private nonNegativeNumber(value: unknown, fallback = 0): number {
    return Math.max(0, this.numberField(value, fallback));
  }

  private nonNegativeInteger(value: unknown): number {
    return Math.max(0, Math.trunc(this.numberField(value)));
  }

  private positiveInteger(value: unknown, fallback: number): number {
    const n = Math.trunc(this.numberField(value, fallback));
    return n > 0 ? n : fallback;
  }
}
