import {
  ArrayUnique,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from "class-validator";

export class PreviewNutritionDto {
  @IsString()
  gender!: string;

  @IsNumber()
  @Min(1)
  age!: number;

  @IsNumber()
  @Min(1)
  heightCm!: number;

  @IsNumber()
  @Min(0.1)
  currentWeightKg!: number;

  @IsString()
  activityLevel!: string;

  @IsString()
  goalType!: string;

  // Accepted for backward compatibility but currently ignored by preview:
  // BMR/TDEE/macro preview does not apply condition rules. Condition-specific
  // nutrient limits are applied at onboarding completion via the threshold
  // builder (UserThresholdBuilderService + ConditionNutrientRuleApplierService).
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  conditionTypes?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  goalWeightKg?: number;
}
