import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ConfigService } from "@nestjs/config";
import * as path from "path";
import * as dotenv from "dotenv";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { MealPlanningModule } from "./meal-planning/meal-planning.module";
import { RecipeBuilderModule } from "./recipe-builder/recipe-builder.module";
import { AuthModule } from "./auth/auth.module";
import { NutritionModule } from "./nutrition/nutrition.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { UsersModule } from "./users/users.module";
import { ExercisesModule } from "./exercises/exercises.module";
import { ExerciseLogsModule } from "./exercise-logs/exercise-logs.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DashboardEventsModule } from "./dashboard/dashboard-events.module";
import { WaterLogModule } from "./water-log/water-log.module";
import { WeightModule } from "./weight/weight.module";
import { ProgressModule } from "./progress/progress.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { HealthController } from "./health.controller";
import { AdminModule } from "./admin/admin.module";
import { UserNotificationsModule } from "./user-notifications/user-notifications.module";

const envFilePath = path.join(__dirname, "..", ".env");
dotenv.config({ path: envFilePath, override: true });

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        host: config.get<string>("POSTGRES_HOST") || "localhost",
        port: Number(config.get<string>("POSTGRES_PORT") || 5432),
        username: config.get<string>("POSTGRES_USER") || "postgres",
        password: config.get<string>("POSTGRES_PASSWORD") || "postgres",
        database: config.get<string>("POSTGRES_DB") || "nutrition_rag",
        autoLoadEntities: true,
        synchronize: false,
        ssl: String(config.get<string>("POSTGRES_SSL") || "false").toLowerCase() === "true"
          ? { rejectUnauthorized: false }
          : false
      })
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    MealPlanningModule,
    RecipeBuilderModule,
    NutritionModule,
    OnboardingModule,
    UsersModule,
    ExercisesModule,
    ExerciseLogsModule,
    DashboardEventsModule,
    DashboardModule,
    WaterLogModule,
    WeightModule,
    ProgressModule,
    UserNotificationsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter
    }
  ]
})
export class AppModule {}
