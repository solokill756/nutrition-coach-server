import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateLogFoodDto {
  @IsOptional() @IsInt() @Min(1)
  foodId?: number;

  @IsOptional() @IsInt() @Min(1)
  mealId?: number;

  @IsOptional() @IsInt() @Min(1)
  recipeId?: number;

  @IsDateString()
  loggedOn!: string;

  @IsOptional() @IsDateString()
  LoggedAt?: string;

  @IsOptional() @IsNumber() @Min(0)
  numberOfServings?: number;

  @IsOptional() @IsNumber() @Min(0)
  servingSize?: number;

  @IsOptional() @IsString()
  unit?: string;

  @IsString()
  meal!: string;

  @IsOptional() @IsString()
  type?: string;

  @IsOptional() @IsString()
  foodName?: string;

  @IsOptional() @IsNumber() @Min(0)
  calories?: number;

  @IsOptional() @IsNumber() @Min(0)
  totalFatG?: number;

  @IsOptional() @IsNumber() @Min(0)
  totalCarbohydratesG?: number;

  @IsOptional() @IsNumber() @Min(0)
  proteinG?: number;

  @IsOptional() @IsNumber() @Min(0)
  sodiumMg?: number;

  @IsOptional() @IsNumber() @Min(0)
  dietaryFibersG?: number;

  @IsOptional() @IsNumber() @Min(0)
  sugarsG?: number;

  @IsOptional() @IsNumber() @Min(0)
  saturatedFatG?: number;

  @IsOptional() @IsNumber() @Min(0)
  cholesterolMg?: number;

  @IsOptional() @IsNumber() @Min(0)
  potassiumMg?: number;

  @IsOptional() @IsNumber() @Min(0)
  calciumMg?: number;

  @IsOptional() @IsNumber() @Min(0)
  ironMg?: number;

  @IsOptional() @IsNumber() @Min(0)
  magnesiumMg?: number;

  @IsOptional() @IsNumber() @Min(0)
  phosphorusMg?: number;

  @IsOptional() @IsNumber() @Min(0)
  zincMg?: number;

  @IsOptional() @IsNumber() @Min(0)
  vitaminAUg?: number;

  @IsOptional() @IsNumber() @Min(0)
  vitaminCMg?: number;

  @IsOptional() @IsNumber() @Min(0)
  vitaminDUg?: number;

  @IsOptional() @IsNumber() @Min(0)
  vitaminEMg?: number;

  @IsOptional() @IsNumber() @Min(0)
  vitaminKUg?: number;

  @IsOptional() @IsNumber() @Min(0)
  vitaminB6Mg?: number;

  @IsOptional() @IsNumber() @Min(0)
  vitaminB12Ug?: number;

  @IsOptional() @IsNumber() @Min(0)
  folateDfeUg?: number;
}
