export class WaterLogDto {
  amountMl!: number;
  targetMl!: number;
}

export class ExerciseEntryDto {
  id!: string;
  name!: string;
  caloriesBurned!: number;
  duration!: number;
}

export class LogFoodItemDto {
  id!: number;
  foodId?: number | null;
  foodName!: string;
  calories!: number;
  numberOfServings!: number;
  servingSize!: number | null;
  unit?: string | null;
  proteinG!: number;
  totalCarbohydratesG!: number;
  totalFatG!: number;
  sodiumMg!: number;
  dietaryFibersG!: number;
  sugarsG!: number;
  saturatedFatG!: number;
  cholesterolMg!: number;
  potassiumMg!: number;
  calciumMg!: number;
  ironMg!: number;
  magnesiumMg!: number;
  phosphorusMg!: number;
  zincMg!: number;
  vitaminAUg!: number;
  vitaminCMg!: number;
  vitaminDUg!: number;
  vitaminEMg!: number;
  vitaminKUg!: number;
  vitaminB6Mg!: number;
  vitaminB12Ug!: number;
  folateDfeUg!: number;
  food?: { description?: string; brandName?: string; servingUnit?: string } | null;
  loggedMeal?: { name?: string } | null;
  loggedRecipe?: { title?: string } | null;
}

export class MealGroupDto {
  mealType!: string;
  logs!: LogFoodItemDto[];
}

export class DiaryDayResponseDto {
  date!: string;
  targetCalories!: number;
  caloriesRemaining!: number;
  totalCalories!: number;
  totalProtein!: number;
  totalCarbs!: number;
  totalFat!: number;
  totalSodiumMg!: number;
  totalDietaryFibersG!: number;
  totalSugarsG!: number;
  totalSaturatedFatG!: number;
  totalCholesterolMg!: number;
  totalPotassiumMg!: number;
  totalCalciumMg!: number;
  totalIronMg!: number;
  totalMagnesiumMg!: number;
  totalPhosphorusMg!: number;
  totalZincMg!: number;
  totalVitaminAUg!: number;
  totalVitaminCMg!: number;
  totalVitaminDUg!: number;
  totalVitaminEMg!: number;
  totalVitaminKUg!: number;
  totalVitaminB6Mg!: number;
  totalVitaminB12Ug!: number;
  totalFolateDfeUg!: number;
  exerciseCaloriesBurned!: number;
  exercises!: ExerciseEntryDto[];
  isCompleted!: boolean;
  note!: string | null;
  mealGroups!: MealGroupDto[];
  waterLog!: WaterLogDto;
}
