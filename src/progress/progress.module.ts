import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { DailyDiaryStatusEntity } from "../nutrition/entities/daily-diary-status.entity";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { WaterLogEntity } from "../nutrition/entities/water-log.entity";
import { WeightModule } from "../weight/weight.module";
import { ProgressController } from "./progress.controller";
import { ProgressService } from "./progress.service";

@Module({
  imports: [
    AuthModule,
    CommonModule,
    WeightModule,
    TypeOrmModule.forFeature([WaterLogEntity, DailyDiaryStatusEntity, UserGoalEntity]),
  ],
  controllers: [ProgressController],
  providers: [ProgressService],
})
export class ProgressModule {}
