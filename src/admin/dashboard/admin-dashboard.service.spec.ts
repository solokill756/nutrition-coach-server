import { Repository } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";
import { ExerciseEntity } from "../../exercises/entities/exercise.entity";
import { FoodNutritionEntity } from "../../meal-planning/entities/food-nutrition.entity";
import { RecipeEntity } from "../../recipe-builder/entities/recipe.entity";
import { AdminDashboardService } from "./admin-dashboard.service";

type CountableRepo<TEntity extends object> = Pick<Repository<TEntity>, "count">;

function mockRepo<TEntity extends object>(counts: number[]): CountableRepo<TEntity> {
  return {
    count: jest.fn().mockImplementation(() => Promise.resolve(counts.shift() ?? 0)),
  };
}

describe("AdminDashboardService", () => {
  it("returns overview counts and applies expected filters", async () => {
    const userRepo = mockRepo<AppUserEntity>([100, 85, 15]);
    const foodRepo = mockRepo<FoodNutritionEntity>([1200, 980, 220]);
    const exerciseRepo = mockRepo<ExerciseEntity>([50]);
    const recipeRepo = mockRepo<RecipeEntity>([30]);
    const service = new AdminDashboardService(
      userRepo as Repository<AppUserEntity>,
      foodRepo as Repository<FoodNutritionEntity>,
      exerciseRepo as Repository<ExerciseEntity>,
      recipeRepo as Repository<RecipeEntity>,
    );

    await expect(service.getOverview()).resolves.toEqual({
      success: true,
      data: {
        totalUsers: 100,
        activeUsers: 85,
        blockedUsers: 15,
        totalFoods: 1200,
        verifiedFoods: 980,
        unverifiedFoods: 220,
        totalExercises: 50,
        totalRecipes: 30,
      },
    });

    expect(userRepo.count).toHaveBeenNthCalledWith(1, { where: { delFlag: false } });
    expect(userRepo.count).toHaveBeenNthCalledWith(2, { where: { status: 1, delFlag: false } });
    expect(userRepo.count).toHaveBeenNthCalledWith(3, { where: { status: 0, delFlag: false } });
    expect(foodRepo.count).toHaveBeenNthCalledWith(1, { where: { delFlag: false } });
    expect(foodRepo.count).toHaveBeenNthCalledWith(2, { where: { isVerified: true, delFlag: false } });
    expect(foodRepo.count).toHaveBeenNthCalledWith(3, { where: { isVerified: false, delFlag: false } });
    expect(exerciseRepo.count).toHaveBeenCalledWith({ where: { delFlag: false } });
    expect(recipeRepo.count).toHaveBeenCalledWith({ where: { delFlag: false } });
  });
});
