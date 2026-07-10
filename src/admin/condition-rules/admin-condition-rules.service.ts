import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import { ConditionNutrientRuleApplierService } from "../../nutrition/condition-nutrient-rule-applier.service";
import { ConditionNutrientUnitService } from "../../nutrition/condition-nutrient-unit.service";
import { NutritionCalculatorService } from "../../nutrition/nutrition-calculator.service";
import { UserContextService } from "../../nutrition/user-context.service";
import { UserThresholdPersistenceService } from "../../nutrition/user-threshold-persistence.service";
import { AppUserEntity } from "../../auth/entities/app-user.entity";
import { ConditionNutrientRuleEntity } from "../../nutrition/entities/condition-nutrient-rule.entity";
import { UserGoalEntity } from "../../nutrition/entities/user-goal.entity";
import { UserHealthConditionEntity } from "../../nutrition/entities/user-health-condition.entity";
import { UserNutritionalThresholdEntity } from "../../nutrition/entities/user-nutritional-threshold.entity";
import { UserNotificationService } from "../../user-notifications/user-notification.service";
import { AdminConditionRuleException } from "./admin-condition-rules.exception";
import { WriteAdminConditionRulesRequestDto } from "./dto/admin-condition-rule-request.dto";
import { AdminConditionRuleListResponseDto, AdminConditionRulePreviewResponseDto, AdminConditionRuleResponseDto, RebalanceAggregate } from "./dto/admin-condition-rule-response.dto";

const THRESHOLD_ADJUSTED_MESSAGE =
  "Your nutrition target was adjusted because medical guidance was updated.";

@Injectable()
export class AdminConditionRulesService {
  private readonly logger = new Logger(AdminConditionRulesService.name);

  constructor(
    @InjectRepository(ConditionNutrientRuleEntity) private readonly ruleRepo: Repository<ConditionNutrientRuleEntity>,
    @InjectRepository(UserHealthConditionEntity) private readonly healthRepo: Repository<UserHealthConditionEntity>,
    @InjectRepository(UserNutritionalThresholdEntity) private readonly thresholdRepo: Repository<UserNutritionalThresholdEntity>,
    @InjectRepository(AppUserEntity) private readonly userRepo: Repository<AppUserEntity>,
    @InjectRepository(UserGoalEntity) private readonly goalRepo: Repository<UserGoalEntity>,
    private readonly dataSource: DataSource,
    private readonly units: ConditionNutrientUnitService,
    private readonly applier: ConditionNutrientRuleApplierService,
    private readonly calculator: NutritionCalculatorService,
    private readonly userNotifications: UserNotificationService,
    private readonly userContext: UserContextService,
    private readonly thresholdPersistence: UserThresholdPersistenceService,
  ) {}

  async list(conditionKey?: string): Promise<AdminConditionRuleListResponseDto> {
    const where = conditionKey ? { conditionKey } : {};
    const rows = await this.ruleRepo.find({ where, order: { conditionKey: "ASC", nutrient: "ASC" } });
    return { success: true, data: rows.map((row) => this.toRuleDto(row)) };
  }

  async preview(dto: WriteAdminConditionRulesRequestDto): Promise<AdminConditionRulePreviewResponseDto> {
    return { success: true, data: await this.buildPreview(dto, false) };
  }

  async apply(conditionKey: string, dto: WriteAdminConditionRulesRequestDto): Promise<AdminConditionRulePreviewResponseDto> {
    if (conditionKey.trim().toLowerCase() !== dto.conditionKey.trim().toLowerCase()) {
      throw new AdminConditionRuleException("CONDITION_RULE_INVALID", HttpStatus.BAD_REQUEST);
    }
    const preview = await this.buildPreview(dto, true);
    if (preview.warnings.length > 0 && !dto.confirmRiskyChanges) {
      throw new AdminConditionRuleException("CONDITION_RULE_RISK_CONFIRMATION_REQUIRED", HttpStatus.BAD_REQUEST);
    }
    const saved = await this.upsertRules(dto.conditionKey, dto.rules);
    await this.persistAffectedThresholds(dto, saved);
    return { success: true, data: preview };
  }

  async updateStatus(conditionKey: string, ruleId: number, isActive: boolean): Promise<AdminConditionRulePreviewResponseDto> {
    const rule = await this.ruleRepo.findOne({ where: { id: ruleId } });
    if (!rule || rule.conditionKey.trim().toLowerCase() !== conditionKey.trim().toLowerCase()) {
      throw new AdminConditionRuleException("CONDITION_RULE_NOT_FOUND", HttpStatus.NOT_FOUND);
    }
    await this.ruleRepo.update(ruleId, { isActive });
    const preview = await this.buildPreview({
      conditionKey,
      rules: [{
        nutrient: rule.nutrient,
        minAmount: isActive ? rule.minAmount : null,
        maxAmount: isActive ? rule.maxAmount : null,
        unit: rule.unit,
        rebalanceMode: rule.rebalanceMode,
        isActive,
      }],
      confirmRiskyChanges: true,
    }, true);
    return { success: true, data: preview };
  }

  private async upsertRules(
    conditionKey: string,
    rules: WriteAdminConditionRulesRequestDto["rules"],
  ): Promise<ConditionNutrientRuleEntity[]> {
    const normalizedKey = conditionKey.trim().toLowerCase();
    const existing = await this.ruleRepo
      .createQueryBuilder("rule")
      .where("LOWER(rule.conditionKey) = LOWER(:conditionKey)", { conditionKey: normalizedKey })
      .getMany();
    const existingByNutrient = new Map(
      existing.map((row) => [row.nutrient.trim().toLowerCase(), row]),
    );

    const saved: ConditionNutrientRuleEntity[] = [];
    for (const rule of rules) {
      const nutrient = rule.nutrient.trim();
      const current = existingByNutrient.get(nutrient.toLowerCase());
      const entity = current ?? this.ruleRepo.create({
        conditionKey: normalizedKey,
        nutrient,
      });
      entity.conditionKey = normalizedKey;
      entity.nutrient = nutrient;
      entity.minAmount = rule.minAmount ?? null;
      entity.maxAmount = rule.maxAmount ?? null;
      entity.unit = rule.unit.trim();
      entity.rebalanceMode = rule.rebalanceMode;
      entity.isActive = rule.isActive;
      saved.push(await this.ruleRepo.save(entity));
    }
    return saved;
  }

  private async buildPreview(dto: WriteAdminConditionRulesRequestDto, includeUpdates: boolean) {
    this.validateDto(dto);
    const affected = await this.findActiveUsersByConditionKey(dto.conditionKey);
    const userIds = [...new Set(affected.map((item) => Number(item.userId)))];

    if (userIds.length === 0) {
      return {
        affectedUsers: 0,
        updatedUsers: 0,
        updatedThresholds: 0,
        warnings: [],
        rebalance: { applied: 0, fallbackStrict: 0, adjustedNutrients: {} },
        samples: [],
      };
    }

    // Run applyRules for each user to collect real rebalance stats
    const allThresholds = await this.thresholdRepo.find({ where: { userId: In(userIds), isActive: true } });
    const warnings = allThresholds.some((row) => row.isCustomized) ? ["USER_CUSTOM_THRESHOLD_WILL_BE_OVERRIDDEN"] : [];
    const rebalanceAgg: RebalanceAggregate = { applied: 0, fallbackStrict: 0, adjustedNutrients: {} };
    const MAX_SAMPLES = 3;
    const samples: Array<{ userId: number; before: AdminConditionRuleResponseDto[]; after: AdminConditionRuleResponseDto[] }> = [];

    for (const userId of userIds) {
      const userThresholds = allThresholds.filter((t) => t.userId === userId);
      const { macroPercentages, bodyWeightKg } = await this.getUserMacroContext(userId);
      const result = this.applier.applyRules({
        targetCalories: Number(userThresholds.find((row) => row.nutrient === "calories")?.maxAmount ?? 2000),
        baseThresholds: userThresholds,
        activeConditionKeys: [dto.conditionKey],
        rules: dto.rules.map((r) => ({
          conditionKey: dto.conditionKey,
          nutrient: r.nutrient,
          minAmount: r.minAmount ?? null,
          maxAmount: r.maxAmount ?? null,
          unit: r.unit,
          rebalanceMode: r.rebalanceMode,
          isActive: r.isActive,
        })),
        allowAutoRebalance: dto.confirmRiskyChanges === true,
        macroPercentages,
        bodyWeightKg,
      });

      // Aggregate rebalance stats
      if (result.rebalance.status === "applied") {
        rebalanceAgg.applied++;
        for (const nutrient of result.rebalance.adjustedNutrients) {
          rebalanceAgg.adjustedNutrients[nutrient] =
            (rebalanceAgg.adjustedNutrients[nutrient] ?? 0) + 1;
        }
      } else if (result.rebalance.status === "fallback_strict") {
        rebalanceAgg.fallbackStrict++;
      }

      // Collect samples (first MAX_SAMPLES users)
      if (samples.length < MAX_SAMPLES && result.changedNutrients.length > 0) {
        const changedSet = new Set(result.changedNutrients);
        samples.push({
          userId,
          before: userThresholds
            .filter((t) => changedSet.has(t.nutrient))
            .map((t) => this.toThresholdDto(t)),
          after: result.thresholds
            .filter((t) => changedSet.has(t.nutrient))
            .map((t) => this.toThresholdDto(t as UserNutritionalThresholdEntity)),
        });
      }
    }

    return {
      affectedUsers: userIds.length,
      updatedUsers: includeUpdates ? userIds.length : 0,
      updatedThresholds: allThresholds.length,
      warnings,
      rebalance: rebalanceAgg,
      samples,
    };
  }

  private async persistAffectedThresholds(dto: WriteAdminConditionRulesRequestDto, savedRules: ConditionNutrientRuleEntity[]) {
    const affected = await this.findActiveUsersByConditionKey(dto.conditionKey);
    const userIds = [...new Set(affected.map((item) => Number(item.userId)))];

    await this.dataSource.transaction(async (manager) => {
      for (const userId of userIds) {
        const thresholds = await manager.find(UserNutritionalThresholdEntity, {
          where: { userId, isActive: true },
        });
        const { macroPercentages, bodyWeightKg } = await this.getUserMacroContext(userId);
        const result = this.applier.applyRules({
          targetCalories: Number(thresholds.find((row) => row.nutrient === "calories")?.maxAmount ?? 2000),
          baseThresholds: thresholds,
          activeConditionKeys: [dto.conditionKey],
          rules: savedRules.map((rule) => ({ ...rule })),
          allowAutoRebalance: dto.confirmRiskyChanges === true,
          macroPercentages,
          bodyWeightKg,
        });

        // Upsert thresholds in place (unique per user + nutrient).
        await this.thresholdPersistence.replaceUserThresholds(
          manager,
          userId,
          result.thresholds.map((row) => ({
            ...row,
            userId,
            isActive: row.isActive ?? true,
          })),
        );

        // Invalidate cache and send notification (outside transaction — no DB writes)
        this.userContext.invalidateUserCache(userId);
        if (result.changedNutrients.length > 0) {
          try {
            await this.userNotifications.create({
              userId,
              type: "threshold_adjusted",
              title: "Nutrition target updated",
              body: THRESHOLD_ADJUSTED_MESSAGE,
              payload: {
                conditionKey: dto.conditionKey,
                nutrients: result.changedNutrients,
                deepLink: "nutrition",
              },
            });
          } catch (error) {
            this.logger.error(`Failed to create user notification for userId=${userId}`, error);
          }
        }
      }
    });
  }

  private async findActiveUsersByConditionKey(conditionKey: string): Promise<UserHealthConditionEntity[]> {
    const normalizedKey = conditionKey.trim().toLowerCase();
    return this.healthRepo
      .createQueryBuilder("health")
      .where("health.isActive = :active", { active: true })
      .andWhere("LOWER(health.conditionName) = :conditionKey", { conditionKey: normalizedKey })
      .getMany();
  }

  /** Compute per-user macro percentages and body weight for accurate rebalance. */
  private async getUserMacroContext(userId: number): Promise<{
    macroPercentages?: { proteinPercent: number; carbsPercent: number; fatPercent: number };
    bodyWeightKg: number | undefined;
  }> {
    const [user, goals] = await Promise.all([
      this.userRepo.findOne({ where: { id: userId } }),
      this.goalRepo.find({ where: { userId, isActive: true }, order: { id: "DESC" }, take: 1 }),
    ]);

    const goal = goals[0];
    const targetCalories = goal?.targetCalories ?? 2000;
    const breakdown = this.calculator.macroBreakdownForGoal({
      gender: user?.sex ?? null,
      age: user?.age ?? null,
      heightCm: user?.height ?? null,
      currentWeightKg: user?.weight ?? null,
      activityLevel: user?.fitnessLevel ?? null,
      goalType: goal?.goalType ?? null,
      targetCalories,
    });
    return {
      macroPercentages: {
        proteinPercent: breakdown.proteinPercent,
        carbsPercent: breakdown.carbsPercent,
        fatPercent: breakdown.fatPercent,
      },
      bodyWeightKg: user?.weight ?? undefined,
    };
  }

  private validateDto(dto: WriteAdminConditionRulesRequestDto): void {
    for (const rule of dto.rules) {
      if (!rule.isActive) continue;
      if (rule.minAmount == null && rule.maxAmount == null) {
        throw new AdminConditionRuleException("CONDITION_RULE_INVALID", HttpStatus.BAD_REQUEST);
      }
      if (rule.minAmount != null && rule.maxAmount != null && rule.minAmount > rule.maxAmount) {
        throw new AdminConditionRuleException("CONDITION_RULE_INVALID", HttpStatus.BAD_REQUEST);
      }
      if (rule.minAmount != null) this.units.normalizeAmount(rule.nutrient, rule.minAmount, rule.unit, 2000);
      if (rule.maxAmount != null) this.units.normalizeAmount(rule.nutrient, rule.maxAmount, rule.unit, 2000);
    }
  }

  private toRuleDto(row: ConditionNutrientRuleEntity) {
    return {
      id: Number(row.id),
      conditionKey: row.conditionKey,
      nutrient: row.nutrient,
      minAmount: row.minAmount,
      maxAmount: row.maxAmount,
      unit: row.unit,
      rebalanceMode: row.rebalanceMode,
      isActive: row.isActive,
    };
  }

  private toThresholdDto(row: UserNutritionalThresholdEntity): AdminConditionRuleResponseDto {
    return {
      id: Number(row.id) || null,
      conditionKey: "",
      nutrient: row.nutrient,
      minAmount: row.minAmount,
      maxAmount: row.maxAmount,
      unit: row.unit,
      rebalanceMode: "strict",
      isActive: row.isActive,
    };
  }
}
