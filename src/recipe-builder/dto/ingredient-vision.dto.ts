import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class RecognizeIngredientsDto {
  @IsUrl({ require_protocol: true })
  imageUrl!: string;

  @IsOptional()
  @Type(() => Number)
  @Min(3)
  @Max(5)
  topK?: number;
}

export class MatchIngredientInputDto {
  @IsOptional()
  @IsString()
  clientIngredientId?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class MatchIngredientsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MatchIngredientInputDto)
  ingredients!: MatchIngredientInputDto[];

  @IsOptional()
  @Type(() => Number)
  @Min(3)
  @Max(5)
  topK?: number;
}

