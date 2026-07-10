import { Module } from "@nestjs/common";
import { RecipeBuilderController } from "./recipe-builder.controller";
import { RecipeBuilderService } from "./recipe-builder.service";
import { FridgeMealPlannerController } from "./fridge-meal-planner.controller";
import { FridgeMealPlannerService } from "./fridge-meal-planner.service";
import { OllamaModule } from "../ollama/ollama.module";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { NutritionModule } from "../nutrition/nutrition.module";
import { MealPlanningModule } from "../meal-planning/meal-planning.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RecipeEntity } from "./entities/recipe.entity";
import { RecipeIngredientEntity } from "./entities/recipe-ingredient.entity";
import { RecipeStepEntity } from "./entities/recipe-step.entity";
import { FridgeManualPlanGenerationEntity } from "./entities/fridge-manual-plan-generation.entity";
import { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { LogFoodEntity } from "../nutrition/entities/log-food.entity";
import { AiIngredientVisionService } from "./ai-ingredient-vision.service";
import { FoodSemanticSearchService } from "./food-semantic-search.service";
import { FridgeStapleAllocationService } from "./fridge-staple-allocation.service";

@Module({
  imports: [
    RetrievalModule,
    OllamaModule,
    NutritionModule,
    MealPlanningModule,
    TypeOrmModule.forFeature([
      RecipeEntity,
      RecipeIngredientEntity,
      RecipeStepEntity,
      FoodNutritionEntity,
      AppUserEntity,
      LogFoodEntity,
      FridgeManualPlanGenerationEntity,
    ]),
  ],
  controllers: [RecipeBuilderController, FridgeMealPlannerController],
  providers: [
    RecipeBuilderService,
    FridgeMealPlannerService,
    FridgeStapleAllocationService,
    AiIngredientVisionService,
    FoodSemanticSearchService,
  ],
  exports: [RecipeBuilderService, FridgeMealPlannerService]
})
export class RecipeBuilderModule {}
