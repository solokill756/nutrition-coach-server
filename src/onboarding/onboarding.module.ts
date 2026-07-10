import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { UserHealthConditionEntity } from "../nutrition/entities/user-health-condition.entity";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";
import { NutritionModule } from "../nutrition/nutrition.module";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AppUserEntity,
      UserGoalEntity,
      UserHealthConditionEntity,
      UserNutritionalThresholdEntity
    ]),
    NutritionModule
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService]
})
export class OnboardingModule {}
