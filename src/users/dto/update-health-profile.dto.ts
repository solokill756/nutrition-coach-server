import { IsArray, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";

export class UpdateUserHealthProfileDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(130)
  age?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(120)
  gender?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsNumber()
  @Min(1)
  @Max(300)
  heightCm?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @IsString({ each: true })
  @Matches(/\S/, { each: true })
  @MaxLength(120, { each: true })
  conditionTypes?: string[];

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @IsString({ each: true })
  @Matches(/\S/, { each: true })
  @MaxLength(120, { each: true })
  allergies?: string[];

  /** null resets the meal distribution to the defaults. */
  @IsOptional()
  @IsObject()
  mealSplits?: Record<string, unknown> | null;
}
