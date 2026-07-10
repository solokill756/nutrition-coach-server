import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { NutritionModule } from "../nutrition/nutrition.module";
import { OllamaModule } from "../ollama/ollama.module";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { ExerciseLogEntity } from "../exercise-logs/entities/exercise-log.entity";
import { LogFoodEntity } from "../nutrition/entities/log-food.entity";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { UserHealthConditionEntity } from "../nutrition/entities/user-health-condition.entity";
import { ConditionNutrientRuleEntity } from "../nutrition/entities/condition-nutrient-rule.entity";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";
import { WaterLogEntity } from "../nutrition/entities/water-log.entity";
import { WeightModule } from "../weight/weight.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardAlertService } from "./dashboard-alert.service";
import { DashboardService } from "./dashboard.service";
import { DashboardAiService } from "./dashboard-ai.service";
import { DashboardEventsModule } from "./dashboard-events.module";

@Module({
  imports: [
    DashboardEventsModule,
    AuthModule,
    CommonModule,
    NutritionModule,
    OllamaModule,
    RetrievalModule,
    WeightModule,
    TypeOrmModule.forFeature([
      AppUserEntity,
      UserGoalEntity,
      ExerciseLogEntity,
      WaterLogEntity,
      LogFoodEntity,
      UserHealthConditionEntity,
      UserNutritionalThresholdEntity,
      ConditionNutrientRuleEntity,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardAlertService, DashboardAiService],
  exports: [DashboardService, DashboardAiService],
})
export class DashboardModule {}
