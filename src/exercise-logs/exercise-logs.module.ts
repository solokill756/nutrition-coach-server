import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { ExerciseEntity } from "../exercises/entities/exercise.entity";
import { WeightModule } from "../weight/weight.module";
import { ExerciseLogEntity } from "./entities/exercise-log.entity";
import { ExerciseLogsService } from "./exercise-logs.service";
import { ExerciseLogsController } from "./exercise-logs.controller";

@Module({
  imports: [TypeOrmModule.forFeature([ExerciseLogEntity, ExerciseEntity, AppUserEntity]), WeightModule],
  controllers: [ExerciseLogsController],
  providers: [ExerciseLogsService],
  exports: [ExerciseLogsService],
})
export class ExerciseLogsModule {}
