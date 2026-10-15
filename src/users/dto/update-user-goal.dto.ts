import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export const MIN_CUSTOM_TARGET_CALORIES = 1200;
export const MAX_CUSTOM_TARGET_CALORIES = 4000;

export class UpdateUserGoalDto {
  @IsString()
  goalType!: string;

  /** User-chosen daily calories; omitted = computed from the profile and goal. */
  @IsOptional()
  @IsInt()
  @Min(MIN_CUSTOM_TARGET_CALORIES)
  @Max(MAX_CUSTOM_TARGET_CALORIES)
  targetCalories?: number;
}
