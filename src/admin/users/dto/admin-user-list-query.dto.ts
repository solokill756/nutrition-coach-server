import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export type AdminUserSortBy = "createdAt" | "displayName" | "email" | "lastLoginAt";
export type AdminUserSortOrder = "asc" | "desc";
export type AdminUserStatusFilter = "active" | "blocked";

export class AdminUserListQueryDto {
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
  role?: string;

  @IsOptional()
  @IsIn(["active", "blocked"])
  status?: AdminUserStatusFilter;

  @IsOptional()
  @IsIn(["createdAt", "displayName", "email", "lastLoginAt"])
  sortBy?: AdminUserSortBy = "createdAt";

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortOrder?: AdminUserSortOrder = "desc";
}
