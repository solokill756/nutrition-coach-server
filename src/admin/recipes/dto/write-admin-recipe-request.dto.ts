import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class AdminRecipeIngredientRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  foodId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;
}

export class AdminRecipeStepRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order!: number;

  @IsString()
  @IsNotEmpty()
  instruction!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  duration?: number | null;

  @IsOptional()
  @IsString()
  tips?: string | null;
}

export class CreateAdminRecipeRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  imageUrl?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  shareWith?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  servings!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  prepMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  cookMinutes!: number;

  @IsIn(["easy", "medium", "hard"])
  difficulty!: "easy" | "medium" | "hard";

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  sourceType?: string | null;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isVerified?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminRecipeIngredientRequestDto)
  ingredients!: AdminRecipeIngredientRequestDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminRecipeStepRequestDto)
  steps!: AdminRecipeStepRequestDto[];
}

export class UpdateAdminRecipeRequestDto extends CreateAdminRecipeRequestDto {}

export class UpdateRecipeVerifyRequestDto {
  @Type(() => Boolean)
  @IsBoolean()
  isVerified!: boolean;
}
