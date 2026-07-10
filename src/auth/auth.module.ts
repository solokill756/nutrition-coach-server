import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CommonModule } from "../common/common.module";
import { WeightModule } from "../weight/weight.module";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { UserHealthConditionEntity } from "../nutrition/entities/user-health-condition.entity";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";
import { LogFoodEntity } from "../nutrition/entities/log-food.entity";
import { DailyDiaryStatusEntity } from "../nutrition/entities/daily-diary-status.entity";
import { WaterLogEntity } from "../nutrition/entities/water-log.entity";
import { ExerciseLogEntity } from "../exercise-logs/entities/exercise-log.entity";
import { ExerciseEntity } from "../exercises/entities/exercise.entity";
import { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import { MealEntity } from "../meal-planning/entities/meal.entity";
import { NutritionModule } from "../nutrition/nutrition.module";
import { LogFoodController } from "../nutrition/log-food.controller";
import { DiaryController } from "../nutrition/diary.controller";
import { LogFoodService } from "../nutrition/log-food.service";
import { DiaryService } from "../nutrition/diary.service";
import { LogFoodSchemaRepairService } from "../nutrition/log-food-schema-repair.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";
import { AppUserEntity } from "./entities/app-user.entity";
import { UserSessionEntity } from "./entities/user-session.entity";
import { UserExternalAccountEntity } from "./entities/user-external-account.entity";
import { AuthService } from "./auth.service";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
    TypeOrmModule.forFeature([
      AppUserEntity,
      UserSessionEntity,
      UserExternalAccountEntity,
      UserGoalEntity,
      UserHealthConditionEntity,
      UserNutritionalThresholdEntity,
      LogFoodEntity,
      FoodNutritionEntity,
      MealEntity,
      DailyDiaryStatusEntity,
      WaterLogEntity,
      ExerciseLogEntity,
      ExerciseEntity,
    ]),
    NutritionModule,
    CommonModule,
    WeightModule,
  ],
  controllers: [AuthController, LogFoodController, DiaryController],
  providers: [AuthService, JwtStrategy, LogFoodService, DiaryService, LogFoodSchemaRepairService],
  exports: [AuthService, DiaryService],
})
export class AuthModule {}
