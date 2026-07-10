import { Type } from "class-transformer";
import { IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { ExerciseType } from "../entities/exercise.entity";

export class CreateExerciseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name!: string;

  @IsEnum(ExerciseType)
  type!: ExerciseType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99.99)
  met?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999.99)
  defaultCalPerMin?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
