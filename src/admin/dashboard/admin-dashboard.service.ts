import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";
import { ExerciseEntity } from "../../exercises/entities/exercise.entity";
import { FoodNutritionEntity } from "../../meal-planning/entities/food-nutrition.entity";
import { RecipeEntity } from "../../recipe-builder/entities/recipe.entity";
import { AdminDashboardOverviewResponseDto } from "./dto/admin-dashboard-overview-response.dto";

@Injectable()
export class AdminDashboardService {
  constructor(
    @InjectRepository(AppUserEntity)
    private readonly userRepo: Repository<AppUserEntity>,
    @InjectRepository(FoodNutritionEntity)
    private readonly foodRepo: Repository<FoodNutritionEntity>,
    @InjectRepository(ExerciseEntity)
    private readonly exerciseRepo: Repository<ExerciseEntity>,
    @InjectRepository(RecipeEntity)
    private readonly recipeRepo: Repository<RecipeEntity>,
  ) {}

  async getOverview(): Promise<AdminDashboardOverviewResponseDto> {
    const [
      totalUsers,
      activeUsers,
      blockedUsers,
      totalFoods,
      verifiedFoods,
      unverifiedFoods,
      totalExercises,
      totalRecipes,
    ] = await Promise.all([
      this.userRepo.count({ where: { delFlag: false } }),
      this.userRepo.count({ where: { status: 1, delFlag: false } }),
      this.userRepo.count({ where: { status: 0, delFlag: false } }),
      this.foodRepo.count({ where: { delFlag: false } }),
      this.foodRepo.count({ where: { isVerified: true, delFlag: false } }),
      this.foodRepo.count({ where: { isVerified: false, delFlag: false } }),
      this.exerciseRepo.count({ where: { delFlag: false } }),
      this.recipeRepo.count({ where: { delFlag: false } }),
    ]);

    return {
      success: true,
      data: {
        totalUsers,
        activeUsers,
        blockedUsers,
        totalFoods,
        verifiedFoods,
        unverifiedFoods,
        totalExercises,
        totalRecipes,
      },
    };
  }
}
