import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NutritionModule } from "../nutrition/nutrition.module";
import { UserHealthProfileService } from "./user-health-profile.service";
import { UsersController } from "./users.controller";

@Module({
  imports: [AuthModule, NutritionModule],
  providers: [UserHealthProfileService],
  controllers: [UsersController]
})
export class UsersModule {}
