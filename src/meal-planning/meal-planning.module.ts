import { Module } from "@nestjs/common";
import { FoodController } from "./food.controller";
import { OllamaModule } from "../ollama/ollama.module";
import { FoodService } from "./food.service";
import { UsdaFoodDataService } from "./usda-food-data.service";
import { NutritionModule } from "../nutrition/nutrition.module";
import { MealsController } from "./meals.controller";
import { MealsService } from "./meals.service";

import { FoodNutritionEntity } from "./entities/food-nutrition.entity";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MealEntity } from "./entities/meal.entity";
import { MealFoodEntity } from "./entities/meal-food.entity";
import { AppUserEntity } from "../auth/entities/app-user.entity";

@Module({
  imports: [
    OllamaModule,
    NutritionModule,
    TypeOrmModule.forFeature([FoodNutritionEntity, MealEntity, MealFoodEntity, AppUserEntity]),
  ],
  controllers: [FoodController, MealsController],
  providers: [FoodService, MealsService, UsdaFoodDataService],
  exports: [FoodService, MealsService],
})
export class MealPlanningModule {}
