import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CommonModule } from "../common/common.module";
import { WaterLogEntity } from "../nutrition/entities/water-log.entity";
import { WaterLogController } from "./water-log.controller";
import { WaterLogService } from "./water-log.service";

@Module({
  imports: [CommonModule, TypeOrmModule.forFeature([WaterLogEntity])],
  controllers: [WaterLogController],
  providers: [WaterLogService],
  exports: [WaterLogService],
})
export class WaterLogModule {}
