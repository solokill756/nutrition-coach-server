import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { WeightModule } from "../weight/weight.module";
import { HydrationTargetService } from "./hydration/hydration-target.service";

@Module({
  imports: [TypeOrmModule.forFeature([AppUserEntity]), WeightModule],
  providers: [HydrationTargetService],
  exports: [HydrationTargetService],
})
export class CommonModule {}
