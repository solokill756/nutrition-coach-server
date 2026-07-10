import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { ExerciseType } from "../../../exercises/entities/exercise.entity";

export type AdminExerciseSortBy = "name" | "type" | "met" | "defaultCalPerMin" | "createdAt";
export type AdminExerciseSortOrder = "asc" | "desc";

export class AdminExerciseListQueryDto {
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
  @IsIn([ExerciseType.cardio, ExerciseType.strength])
  type?: ExerciseType;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsIn(["name", "type", "met", "defaultCalPerMin", "createdAt"])
  sortBy?: AdminExerciseSortBy = "name";

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortOrder?: AdminExerciseSortOrder = "asc";
}
