import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, Max, Min } from "class-validator";

export class AddWaterDto {
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(3000)
  amountMl!: number;

  @IsOptional()
  @IsDateString()
  date?: string;
}
