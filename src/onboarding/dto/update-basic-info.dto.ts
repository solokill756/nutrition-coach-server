import { IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class UpdateBasicInfoDto {
  @IsString()
  gender!: string;

  @IsNumber()
  @Min(1)
  age!: number;

  @IsNumber()
  @Min(1)
  heightCm!: number;

  @IsNumber()
  @Min(1)
  currentWeightKg!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  goalWeightKg?: number;
}
