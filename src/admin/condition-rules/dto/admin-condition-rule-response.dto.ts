export class AdminConditionRuleResponseDto {
  id!: number | null;
  conditionKey!: string;
  nutrient!: string;
  minAmount!: number | null;
  maxAmount!: number | null;
  unit!: string;
  rebalanceMode!: "strict" | "auto_rebalance";
  isActive!: boolean;
}

export class AdminConditionRulePreviewDto {
  affectedUsers!: number;
  updatedUsers!: number;
  updatedThresholds!: number;
  warnings!: string[];
  rebalance!: {
    applied: number;
    fallbackStrict: number;
    adjustedNutrients: Record<string, number>;
  };
  samples!: Array<{
    userId: number;
    before: AdminConditionRuleResponseDto[];
    after: AdminConditionRuleResponseDto[];
  }>;
}

export type RebalanceAggregate = {
  applied: number;
  fallbackStrict: number;
  adjustedNutrients: Record<string, number>;
};

export class AdminConditionRuleListResponseDto {
  success!: true;
  data!: AdminConditionRuleResponseDto[];
}

export class AdminConditionRulePreviewResponseDto {
  success!: true;
  data!: AdminConditionRulePreviewDto;
}
