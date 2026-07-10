import { Type } from "class-transformer";
import type { MealNutritionTarget } from "../recipe-nutrition-scoring";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export type RecipeMealSlot = "breakfast" | "lunch" | "dinner" | "snack";

export class RecipeBuilderRequest {
  /** Legacy: free-text ingredients when calling without a user / staples. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ingredients?: string[];

  /** Required when authenticated: staples-based generation for one meal. */
  @IsOptional()
  @IsIn(["breakfast", "lunch", "dinner", "snack"])
  mealSlot?: RecipeMealSlot;

  /** Plan date (defaults to server today). Format YYYY-MM-DD. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  /**
   * When set (non-empty), use these Food Ids for this generation only (My Recipes ad-hoc selection).
   * When omitted, load staples from UserStapleFood (More / pantry).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  foodIds?: number[];

  @IsOptional()
  constraints?: {
    maxCalories?: number;
    minCalories?: number;
    preparationTime?: number; // minutes
    difficulty?: "easy" | "medium" | "hard";
    cuisine?: string;
    dietary?: string; // vegan, vegetarian, low-sodium, etc.
    description?: string; // user preference / desired dish style
  };
  @IsOptional()
  userProfile?: {
    age?: number;
    sex?: string;
    dietType?: string;
    conditions?: string[];
    allergies?: string[];
    goal?: string;
  };
}

export class AddStapleFoodDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  foodId!: number;
}

export class RecipeIngredientDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  foodId?: number;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  unit!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  calories?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  protein?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  carbs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fiber?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sodium?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sugar?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  saturatedFat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cholesterol?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  potassium?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  calciumMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ironMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  magnesiumMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  phosphorusMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  zincMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminAUg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminCMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminDUg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminEMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminKUg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminB6Mg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminB12Ug?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  folateDfeUg?: number;
}

export class RecipeStepInputDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order!: number;

  @IsString()
  @IsNotEmpty()
  instruction!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  duration?: number;

  @IsOptional()
  @IsString()
  tips?: string;
}

export class RecipeNutritionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  calories?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  protein?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  carbs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fiber?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sodium?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sugar?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  saturatedFat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  cholesterol?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  potassium?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  calciumMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ironMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  magnesiumMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  phosphorusMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  zincMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminAUg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminCMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminDUg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminEMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminKUg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminB6Mg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminB12Ug?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  folateDfeUg?: number;
}

export class CreateRecipeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  imageUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  shareWith?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  servings!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  prepMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  cookMinutes!: number;

  @IsString()
  @IsIn(["easy", "medium", "hard"])
  difficulty!: "easy" | "medium" | "hard";

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients!: RecipeIngredientDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeStepInputDto)
  steps!: RecipeStepInputDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RecipeNutritionDto)
  nutritionPerServing?: RecipeNutritionDto;

  /** e.g. `ai_recipe_builder` — persisted in recipe `source` JSON for AI-origin recipes. */
  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateKey?: string;

  @IsOptional()
  @IsIn(["breakfast", "lunch", "dinner", "snack"])
  mealSlot?: RecipeMealSlot;

  /** 0–1 nutrition match score vs the slot target (from suggest-recipe). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  score?: number;

  /** Nutrition / safety notices shown with the recipe. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  warnings?: string[];
}

export class UpdateRecipeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  imageUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  shareWith?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  servings!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  prepMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  cookMinutes!: number;

  @IsString()
  @IsIn(["easy", "medium", "hard"])
  difficulty!: "easy" | "medium" | "hard";

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients!: RecipeIngredientDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeStepInputDto)
  steps!: RecipeStepInputDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RecipeNutritionDto)
  nutritionPerServing?: RecipeNutritionDto;

  /** e.g. `ai_recipe_builder` — persisted in recipe `source` JSON for AI-origin recipes. */
  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateKey?: string;

  @IsOptional()
  @IsIn(["breakfast", "lunch", "dinner", "snack"])
  mealSlot?: RecipeMealSlot;

  /** 0–1 nutrition match score vs the slot target (from suggest-recipe). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  score?: number;

  /** Nutrition / safety notices shown with the recipe. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  warnings?: string[];
}

export class RecipeStep {
  order: number = 1;
  instruction: string = "";
  duration?: number; // minutes
  tips?: string;
}

export class NutritionInfo {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sodium?: number;
  sugar?: number;
  saturatedFat?: number;
  cholesterol?: number;
  potassium?: number;
  calciumMg?: number;
  ironMg?: number;
  magnesiumMg?: number;
  phosphorusMg?: number;
  zincMg?: number;
  vitaminAUg?: number;
  vitaminCMg?: number;
  vitaminDUg?: number;
  vitaminEMg?: number;
  vitaminKUg?: number;
  vitaminB6Mg?: number;
  vitaminB12Ug?: number;
  folateDfeUg?: number;
}

export class Recipe {
  name: string = "";
  description: string = "";
  servings: number = 1;
  preparationTime: number = 0;
  cookingTime: number = 0;
  difficulty: "easy" | "medium" | "hard" = "easy";
  ingredients: Array<{
    name: string;
    foodId?: number;
    amount_g?: number;
    amount: number;
    unit: string;
  }> = [];
  steps: RecipeStep[] = [];
  nutritionPerServing: NutritionInfo = {};
  tips?: string[];
}

export class RecipeBuilderResponse {
  recipe: Recipe = new Recipe();
  alternativeRecipes?: Recipe[];
  recommendation: string = "";
  safetyWarnings: string[] = [];
  /** Portion scaling or budget messages for authenticated staple-based runs. */
  generationWarnings?: string[];
  /** ok | adjusted when scaling was applied to fit remaining daily budget. */
  budgetStatus?: "ok" | "adjusted" | "warning";
  evidence: Array<{
    id: string;
    title: string;
    link?: string;
    source: string;
    domain: string;
    score: number;
    isChunk?: boolean;
    parentId?: string;
    chunkIndex?: number;
    chunkTotal?: number;
  }> = [];
  /** 0–1 nutrition match score vs the slot target (authenticated flow). */
  score?: number;
  /** Per-slot nutrition target used to compute the score. */
  nutritionTarget?: MealNutritionTarget;
  /** Warnings when a nutrient deviates from the slot target by > 15%. */
  scoreWarnings?: string[];
}
