import { Transform, Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Min, ValidateIf } from "class-validator";

export class CreateMealDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shareWith?: number;

  @IsOptional()
  @IsString()
  directions?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ValidateIf((_, value) => value !== undefined && value !== "")
  @IsUrl({ require_protocol: true }, { message: "imageUrl must be a valid URL" })
  imageUrl?: string;
}

export class UpdateMealDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shareWith?: number;

  @IsOptional()
  @IsString()
  directions?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ValidateIf((_, value) => value !== undefined && value !== "")
  @IsUrl({ require_protocol: true }, { message: "imageUrl must be a valid URL" })
  imageUrl?: string;
}

export class AddMealItemDto {
  @Type(() => Number)
  @IsInt()
  foodId!: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0.01)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  order?: number;

  @IsOptional()
  @IsString()
  unit?: string;
}

export class UpdateMealItemDto {
  @IsOptional()
  @Type(() => Number)
  @Min(0.01)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  order?: number;

  @IsOptional()
  @IsString()
  unit?: string;
}

export class CopyPreviousMealDto {
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  sourceMealId?: number;

  @IsString()
  @IsNotEmpty()
  name!: string;
}
