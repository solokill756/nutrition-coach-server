import { Type } from "class-transformer";
import { IsDateString, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class UpdateWeightDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1, { message: "weightKg must be positive" })
  weightKg?: number;

  @IsOptional()
  @IsDateString()
  recordedAt?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}
