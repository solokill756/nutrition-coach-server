import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { ExerciseEntity } from "../exercises/entities/exercise.entity";
import { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import { ConditionNutrientRuleEntity } from "../nutrition/entities/condition-nutrient-rule.entity";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { UserHealthConditionEntity } from "../nutrition/entities/user-health-condition.entity";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";
import { NutritionModule } from "../nutrition/nutrition.module";
import { RecipeEntity } from "../recipe-builder/entities/recipe.entity";
import { RecipeIngredientEntity } from "../recipe-builder/entities/recipe-ingredient.entity";
import { RecipeStepEntity } from "../recipe-builder/entities/recipe-step.entity";
import { AdminAuthController } from "./auth/admin-auth.controller";
import { AdminAuthService } from "./auth/admin-auth.service";
import { AdminConditionRulesController } from "./condition-rules/admin-condition-rules.controller";
import { AdminConditionRulesService } from "./condition-rules/admin-condition-rules.service";
import { AdminDashboardController } from "./dashboard/admin-dashboard.controller";
import { AdminDashboardService } from "./dashboard/admin-dashboard.service";
import { AdminExercisesController } from "./exercises/admin-exercises.controller";
import { AdminExercisesService } from "./exercises/admin-exercises.service";
import { AdminFoodsController } from "./foods/admin-foods.controller";
import { AdminFoodsService } from "./foods/admin-foods.service";
import { AdminRagDocumentsController } from "./rag-documents/admin-rag-documents.controller";
import { AdminRagDocumentsService } from "./rag-documents/admin-rag-documents.service";
import { RagIngestModule } from "../rag-ingest/rag-ingest.module";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { AdminRecipesController } from "./recipes/admin-recipes.controller";
import { AdminRecipesService } from "./recipes/admin-recipes.service";
import { AdminUsersController } from "./users/admin-users.controller";
import { AdminUsersService } from "./users/admin-users.service";
import { UserNotificationsModule } from "../user-notifications/user-notifications.module";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
    NutritionModule,
    UserNotificationsModule,
    RagIngestModule,
    RetrievalModule,
    TypeOrmModule.forFeature([
      AppUserEntity,
      FoodNutritionEntity,
      ExerciseEntity,
      RecipeEntity,
      RecipeIngredientEntity,
      RecipeStepEntity,
      ConditionNutrientRuleEntity,
      UserHealthConditionEntity,
      UserGoalEntity,
      UserNutritionalThresholdEntity,
    ]),
  ],
  controllers: [
    AdminAuthController,
    AdminDashboardController,
    AdminFoodsController,
    AdminExercisesController,
    AdminRecipesController,
    AdminUsersController,
    AdminConditionRulesController,
    AdminRagDocumentsController,
  ],
  providers: [
    AdminAuthService,
    AdminDashboardService,
    AdminFoodsService,
    AdminExercisesService,
    AdminRecipesService,
    AdminUsersService,
    AdminConditionRulesService,
    AdminRagDocumentsService,
  ],
})
export class AdminModule {}
