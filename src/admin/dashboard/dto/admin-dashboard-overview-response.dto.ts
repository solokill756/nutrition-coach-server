export class AdminDashboardOverviewDataDto {
  totalUsers!: number;
  activeUsers!: number;
  blockedUsers!: number;
  totalFoods!: number;
  verifiedFoods!: number;
  unverifiedFoods!: number;
  totalExercises!: number;
  totalRecipes!: number;
}

export class AdminDashboardOverviewResponseDto {
  success!: true;
  data!: AdminDashboardOverviewDataDto;
}
