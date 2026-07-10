import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
} from "class-validator";

export class UpdateGoalPreferencesDto {
  @IsString()
  goalType!: string;

  @IsString()
  activityLevel!: string;

  @IsOptional()
  @IsString()
  mealFrequency?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  barriers?: string[];
}
