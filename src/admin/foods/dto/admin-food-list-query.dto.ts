import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export type AdminFoodSortBy = "createdAt" | "foodName" | "calories" | "proteinG";
export type AdminFoodSortOrder = "asc" | "desc";

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value as boolean;
}

export class AdminFoodListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsIn(["createdAt", "foodName", "calories", "proteinG"])
  sortBy?: AdminFoodSortBy = "createdAt";

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortOrder?: AdminFoodSortOrder = "desc";
}
