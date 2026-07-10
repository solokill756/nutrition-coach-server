import { Type } from "class-transformer";
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class UpdateAdminFoodRequestDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  foodName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  servingUnit?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  servingSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  calories?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  proteinG?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalCarbohydratesG?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalFatG?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fiberG?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sodiumMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  saturatedFatG?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cholesterolMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sugarsG?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  potassiumMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  calciumMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ironMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  magnesiumMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  phosphorusMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  zincMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminAUg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminCMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminDUg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminEMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminKUg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminB6Mg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vitaminB12Ug?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  folateDfeUg?: number;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}
