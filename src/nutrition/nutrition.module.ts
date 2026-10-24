import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserGoalEntity } from "./entities/user-goal.entity";
import { UserHealthConditionEntity } from "./entities/user-health-condition.entity";
import { UserNutritionalThresholdEntity } from "./entities/user-nutritional-threshold.entity";
import { DailyNutritionSummaryEntity } from "./entities/daily-nutrition-summary.entity";
import { LogFoodEntity } from "./entities/log-food.entity";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import { RecipeEntity } from "../recipe-builder/entities/recipe.entity";
import { UserStapleFoodEntity } from "./entities/user-staple-food.entity";
import { ConditionNutrientRuleEntity } from "./entities/condition-nutrient-rule.entity";
import { WeightEntity } from "../weight/entities/weight.entity";
import { UserContextService } from "./user-context.service";
import { UserStapleFoodService } from "./user-staple-food.service";
import { NutritionCalculatorService } from "./nutrition-calculator.service";
import { ConditionNutrientUnitService } from "./condition-nutrient-unit.service";
import { ConditionNutrientRuleApplierService } from "./condition-nutrient-rule-applier.service";
import { UserThresholdBuilderService } from "./user-threshold-builder.service";
import { UserThresholdPersistenceService } from "./user-threshold-persistence.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserGoalEntity,
      UserHealthConditionEntity,
      UserNutritionalThresholdEntity,
      DailyNutritionSummaryEntity,
      LogFoodEntity,
      AppUserEntity,
      FoodNutritionEntity,
      RecipeEntity,
      UserStapleFoodEntity,
      ConditionNutrientRuleEntity,
      WeightEntity,
    ]),
  ],
  providers: [
    UserContextService,
    UserStapleFoodService,
    NutritionCalculatorService,
    ConditionNutrientUnitService,
    ConditionNutrientRuleApplierService,
    UserThresholdBuilderService,
    UserThresholdPersistenceService,
  ],
  exports: [
    UserContextService,
    UserStapleFoodService,
    NutritionCalculatorService,
    ConditionNutrientUnitService,
    ConditionNutrientRuleApplierService,
    UserThresholdBuilderService,
    UserThresholdPersistenceService,
  ],
})
export class NutritionModule { }
