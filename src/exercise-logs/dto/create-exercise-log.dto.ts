import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, Min } from "class-validator";

export class CreateExerciseLogDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  exerciseId!: number;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  minutesPerformed!: number;

  @IsOptional()
  @IsIn(["manual", "ai", "device"])
  source?: "manual" | "ai" | "device";
}
