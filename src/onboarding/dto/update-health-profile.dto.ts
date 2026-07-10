import {
  ArrayUnique,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";

export class UpdateHealthProfileDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  conditionTypes!: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  medications?: string[];

  @IsOptional()
  @IsObject()
  conditionSeverities?: Record<string, string>;
}
