import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { NutritionModule } from "../nutrition/nutrition.module";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";
import { WeightEntity } from "./entities/weight.entity";
import { WeightController } from "./weight.controller";
import { WeightService } from "./weight.service";

@Module({
  imports: [
    NutritionModule,
    TypeOrmModule.forFeature([
      WeightEntity,
      AppUserEntity,
      UserGoalEntity,
      UserNutritionalThresholdEntity,
    ]),
  ],
  controllers: [WeightController],
  providers: [WeightService],
  exports: [WeightService],
})
export class WeightModule {}
