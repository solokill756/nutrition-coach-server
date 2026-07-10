import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export type AdminRecipeSortBy = "title" | "userId" | "servings" | "createdAt" | "updatedAt";
export type AdminRecipeSortOrder = "asc" | "desc";

export class AdminRecipeListQueryDto {
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsIn(["title", "userId", "servings", "createdAt", "updatedAt"])
  sortBy?: AdminRecipeSortBy = "createdAt";

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortOrder?: AdminRecipeSortOrder = "desc";
}
