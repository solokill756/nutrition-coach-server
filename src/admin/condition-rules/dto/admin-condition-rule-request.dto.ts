import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from "class-validator";

export class AdminConditionRuleItemRequestDto {
  @IsString()
  @IsNotEmpty()
  nutrient!: string;

  @IsOptional()
  @IsNumber()
  minAmount?: number | null;

  @IsOptional()
  @IsNumber()
  maxAmount?: number | null;

  @IsString()
  @IsNotEmpty()
  unit!: string;

  @IsIn(["strict", "auto_rebalance"])
  rebalanceMode!: "strict" | "auto_rebalance";

  @IsBoolean()
  isActive!: boolean;
}

export class WriteAdminConditionRulesRequestDto {
  @IsString()
  @IsNotEmpty()
  conditionKey!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminConditionRuleItemRequestDto)
  rules!: AdminConditionRuleItemRequestDto[];

  @IsOptional()
  @IsBoolean()
  confirmRiskyChanges?: boolean;
}
