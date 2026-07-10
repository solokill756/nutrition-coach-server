import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RecipeBuilderService } from "./recipe-builder.service";
import {
  AddStapleFoodDto,
  CreateRecipeDto,
  RecipeBuilderRequest,
  RecipeBuilderResponse,
  RecipeMealSlot,
  UpdateRecipeDto,
} from "./dto/recipe.dto";
import { getRequestTzOffsetMinutes } from "../common/date/request-tz-offset";
import { UserStapleFoodService } from "../nutrition/user-staple-food.service";
import { AiIngredientVisionService } from "./ai-ingredient-vision.service";
import { FoodSemanticSearchService } from "./food-semantic-search.service";
import { MatchIngredientsDto, RecognizeIngredientsDto } from "./dto/ingredient-vision.dto";

@Controller("recipe-builder")
export class RecipeBuilderController {
  constructor(
    private readonly recipeBuilderService: RecipeBuilderService,
    private readonly stapleFoodService: UserStapleFoodService,
    private readonly visionService: AiIngredientVisionService,
    private readonly foodSemanticSearchService: FoodSemanticSearchService,
  ) {}

  @Post("vision/recognize")
  @UseGuards(JwtAuthGuard)
  async recognizeIngredients(@Body() input: RecognizeIngredientsDto) {
    const detected = await this.visionService.recognizeIngredients(input.imageUrl);
    const ingredients = await this.foodSemanticSearchService.batchSearchIngredients(
      detected.map((item, index) => ({
        clientIngredientId: `ingredient-${index + 1}`,
        name: item.name,
        confidence: item.confidence,
        notes: item.notes,
      })),
      input.topK ?? 5,
    );
    return { imageUrl: input.imageUrl, ingredients };
  }

  @Post("vision/match")
  @UseGuards(JwtAuthGuard)
  async matchIngredients(@Body() input: MatchIngredientsDto) {
    const ingredients = await this.foodSemanticSearchService.searchIngredients(
      input.ingredients.map((item, index) => ({
        clientIngredientId: item.clientIngredientId || `ingredient-${index + 1}`,
        name: item.name,
        confidence: 1,
      })),
      input.topK ?? 5,
    );
    return { ingredients };
  }

  @Post("generate")
  @UseGuards(JwtAuthGuard)
  async generateRecipe(@Body() input: RecipeBuilderRequest, @Req() req: any): Promise<RecipeBuilderResponse> {
    const userId = req.user?.id ?? req.user?.userId;
    return this.recipeBuilderService.generateRecipe(
      input,
      userId,
      getRequestTzOffsetMinutes(req),
    );
  }

  @Get("staples")
  @UseGuards(JwtAuthGuard)
  async listStaples(@Req() req: any) {
    const userId = req.user?.id ?? req.user?.userId;
    return this.stapleFoodService.listWithFood(userId);
  }

  @Post("staples")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async addStaple(@Req() req: any, @Body() body: AddStapleFoodDto) {
    const userId = req.user?.id ?? req.user?.userId;
    await this.stapleFoodService.add(userId, body.foodId);
  }

  @Delete("staples/:foodId")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeStaple(@Req() req: any, @Param("foodId", ParseIntPipe) foodId: number) {
    const userId = req.user?.id ?? req.user?.userId;
    await this.stapleFoodService.remove(userId, foodId);
  }

  @Get("recipes")
  @UseGuards(JwtAuthGuard)
  async listRecipes(
    @Req() req: any,
    @Query("search") search?: string,
    @Query("sourceType") sourceType?: string,
    @Query("date") date?: string,
    @Query("mealSlot") mealSlot?: string,
    @Query("includeCommunity") includeCommunity?: string,
  ) {
    const userId = req.user?.id ?? req.user?.userId;
    const safeMealSlot = ["breakfast", "lunch", "dinner", "snack"].includes(mealSlot || "")
      ? (mealSlot as RecipeMealSlot)
      : undefined;
    const isCommunity = String(includeCommunity).toLowerCase() === "true";
    return this.recipeBuilderService.listRecipes(userId, search, {
      sourceType,
      date,
      mealSlot: safeMealSlot,
      includeCommunity: isCommunity,
    });
  }

  @Get("recipes/:id")
  @UseGuards(JwtAuthGuard)
  async getRecipeById(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    const userId = req.user?.id ?? req.user?.userId;
    return this.recipeBuilderService.getRecipeById(userId, id);
  }

  @Post("recipes")
  @UseGuards(JwtAuthGuard)
  async createRecipe(@Req() req: any, @Body() input: CreateRecipeDto) {
    const userId = req.user?.id ?? req.user?.userId;
    return this.recipeBuilderService.createRecipe(userId, input);
  }

  @Put("recipes/:id")
  @UseGuards(JwtAuthGuard)
  async updateRecipe(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() input: UpdateRecipeDto,
  ) {
    const userId = req.user?.id ?? req.user?.userId;
    return this.recipeBuilderService.updateRecipe(userId, id, input);
  }

  @Delete("recipes/:id")
  @UseGuards(JwtAuthGuard)
  async deleteRecipe(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    const userId = req.user?.id ?? req.user?.userId;
    return this.recipeBuilderService.deleteRecipe(userId, id);
  }

  @Post("recipes/:id/convert-to-meal")
  @UseGuards(JwtAuthGuard)
  async convertToMeal(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    const userId = req.user?.id ?? req.user?.userId;
    return this.recipeBuilderService.convertToMeal(userId, id);
  }
}
