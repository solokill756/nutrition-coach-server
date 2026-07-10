import { Type } from "class-transformer";
import { IsDateString, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateWeightDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.1, { message: "weightKg must be positive" })
  weightKg!: number;

  @IsDateString()
  recordedAt!: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}
