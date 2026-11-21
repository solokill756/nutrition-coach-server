import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, Repository } from "typeorm";
import { ConditionNutrientRuleApplierService } from "./condition-nutrient-rule-applier.service";
import { ConditionNutrientRuleEntity } from "./entities/condition-nutrient-rule.entity";
import { NutritionCalculatorService, MacroBreakdown } from "./nutrition-calculator.service";

@Injectable()
export class UserThresholdBuilderService {
  constructor(
    private readonly calculator: NutritionCalculatorService,
    private readonly applier: ConditionNutrientRuleApplierService,
    @InjectRepository(ConditionNutrientRuleEntity)
    private readonly ruleRepo: Repository<ConditionNutrientRuleEntity>,
  ) {}

  async build(input: {
    userId: number;
    targetCalories: number;
    macroCenter: MacroBreakdown;
    conditionTypes: string[];
    gender?: string | null;
    allowAutoRebalance: boolean;
    bodyWeightKg?: number;
  }, manager?: EntityManager) {
    const base = this.calculator.buildDefaultThresholds(
      input.userId,
      input.targetCalories,
      input.macroCenter,
      input.gender,
    );
    const conditionKeys = input.conditionTypes.map((item) => item.trim().toLowerCase()).filter(Boolean);
    const ruleRepo = manager?.getRepository(ConditionNutrientRuleEntity) ?? this.ruleRepo;
    const rules = conditionKeys.length === 0
      ? []
      : await ruleRepo.find({ where: { conditionKey: In(conditionKeys), isActive: true } });
    return this.applier.applyRules({
      targetCalories: input.targetCalories,
      baseThresholds: base as never,
      activeConditionKeys: conditionKeys,
      rules,
      allowAutoRebalance: input.allowAutoRebalance,
      macroPercentages: {
        proteinPercent: input.macroCenter.proteinPercent,
        carbsPercent: input.macroCenter.carbsPercent,
        fatPercent: input.macroCenter.fatPercent,
      },
      bodyWeightKg: input.bodyWeightKg,
    });
  }
}
