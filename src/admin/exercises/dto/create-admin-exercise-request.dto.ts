import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { ExerciseType } from "../../../exercises/entities/exercise.entity";

export class CreateAdminExerciseRequestDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsEnum(ExerciseType)
  type!: ExerciseType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  met?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultCalPerMin?: number | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}
