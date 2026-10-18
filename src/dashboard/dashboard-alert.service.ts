import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConditionNutrientRuleEntity } from "../nutrition/entities/condition-nutrient-rule.entity";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";

export type DashboardAlertSeverity = "critical" | "warning";
export type DashboardAlertType = "red" | "yellow";

export type DashboardAlert = {
  id: string;
  type: DashboardAlertType;
  severity: DashboardAlertSeverity;
  nutrientType: string;
  title: string;
  message: string;
  current: number;
  limit: number;
  unit: string;
  percent: number;
  isRead: boolean;
};

export type DashboardDailyTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sodium: number;
  fiber: number;
  sugars: number;
  saturatedFat: number;
  cholesterol: number;
  potassium: number;
  calcium: number;
  iron: number;
  magnesium: number;
  phosphorus: number;
  zinc: number;
  vitaminA: number;
  vitaminC: number;
  vitaminD: number;
  vitaminE: number;
  vitaminK: number;
  vitaminB6: number;
  vitaminB12: number;
  folate: number;
};

type AlertRule = {
  nutrientType: keyof DashboardDailyTotals;
  thresholdKey: string;
  label: string;
  conditionOnly?: boolean;
};

type AlertDirection = "max" | "min";

const MAX_ALERT_RULES: AlertRule[] = [
  { nutrientType: "calories", thresholdKey: "calories", label: "Calories" },
  { nutrientType: "carbs", thresholdKey: "carbs", label: "Carbs" },
  { nutrientType: "fat", thresholdKey: "fat", label: "Fat" },
  { nutrientType: "sugars", thresholdKey: "sugars", label: "Sugars" },
  { nutrientType: "sodium", thresholdKey: "sodium", label: "Sodium" },
  { nutrientType: "saturatedFat", thresholdKey: "saturatedfat", label: "Saturated fat" },
  { nutrientType: "cholesterol", thresholdKey: "cholesterol", label: "Cholesterol" },
  { nutrientType: "protein", thresholdKey: "protein", label: "Protein", conditionOnly: true },
  { nutrientType: "phosphorus", thresholdKey: "phosphorus", label: "Phosphorus" },
];

const MIN_ALERT_RULES: AlertRule[] = [
  { nutrientType: "protein", thresholdKey: "protein", label: "Protein" },
  { nutrientType: "fiber", thresholdKey: "fiber", label: "Fiber" },
  { nutrientType: "potassium", thresholdKey: "potassium", label: "Potassium" },
];

const NUTRIENT_PRIORITY = new Map<string, number>([
  ["sodium", 0],
  ["saturatedFat", 1],
  ["cholesterol", 2],
  ["sugars", 3],
  ["fiber", 4],
  ["potassium", 5],
  ["calcium", 6],
  ["iron", 7],
  ["calories", 8],
  ["carbs", 9],
  ["fat", 10],
  ["protein", 11],
  ["magnesium", 12],
  ["phosphorus", 13],
  ["zinc", 14],
  ["vitaminA", 15],
  ["vitaminC", 16],
  ["vitaminD", 17],
  ["vitaminE", 18],
  ["vitaminK", 19],
  ["vitaminB6", 20],
  ["vitaminB12", 21],
  ["folate", 22],
]);

const SEVERITY_PRIORITY = new Map<DashboardAlertSeverity, number>([
  ["critical", 0],
  ["warning", 1],
]);

@Injectable()
export class DashboardAlertService implements OnModuleInit {
  private readonly conditionNutrients = new Map<string, Set<string>>();

  constructor(
    @InjectRepository(ConditionNutrientRuleEntity)
    private readonly ruleRepo: Repository<ConditionNutrientRuleEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    const rules = await this.ruleRepo.find({ where: { isActive: true } });
    for (const rule of rules) {
      const key = rule.conditionKey.trim().toLowerCase();
      if (!this.conditionNutrients.has(key)) {
        this.conditionNutrients.set(key, new Set());
      }
      this.conditionNutrients.get(key)!.add(this.normalizeNutrientKey(rule.nutrient));
    }
  }

  buildDailyAlerts(
    dateKey: string,
    totals: DashboardDailyTotals,
    thresholds: UserNutritionalThresholdEntity[],
    conditionKeys: string[] = [],
  ): DashboardAlert[] {
    const thresholdByKey = this.indexThresholds(thresholds);
    const alerts = [
      ...MAX_ALERT_RULES.map((rule) =>
        this.buildAlert(dateKey, rule, "max", totals, thresholdByKey.get(rule.thresholdKey)),
      ),
      ...MIN_ALERT_RULES.map((rule) =>
        this.buildAlert(dateKey, rule, "min", totals, thresholdByKey.get(rule.thresholdKey)),
      ),
    ]
      .filter((alert): alert is DashboardAlert => alert != null)
      .sort((a, b) => {
        const aCondition = this.matchesUserCondition(a.nutrientType, conditionKeys);
        const bCondition = this.matchesUserCondition(b.nutrientType, conditionKeys);
        if (aCondition && !bCondition) return -1;
        if (!aCondition && bCondition) return 1;

        const severityDelta =
          (SEVERITY_PRIORITY.get(a.severity) ?? 99) - (SEVERITY_PRIORITY.get(b.severity) ?? 99);
        if (severityDelta !== 0) return severityDelta;
        const priorityDelta =
          (NUTRIENT_PRIORITY.get(a.nutrientType) ?? 99) - (NUTRIENT_PRIORITY.get(b.nutrientType) ?? 99);
        if (priorityDelta !== 0) return priorityDelta;
        return b.percent - a.percent;
      });

    return alerts.slice(0, 3);
  }

  private buildAlert(
    dateKey: string,
    rule: AlertRule,
    direction: AlertDirection,
    totals: DashboardDailyTotals,
    threshold: UserNutritionalThresholdEntity | undefined,
  ): DashboardAlert | null {
    if (rule.conditionOnly && !this.isConditionThreshold(threshold)) {
      return null;
    }
    const current = totals[rule.nutrientType];
    const limit = direction === "max" ? threshold?.maxAmount : threshold?.minAmount;
    if (limit == null || !Number.isFinite(limit) || limit <= 0 || !Number.isFinite(current)) {
      return null;
    }

    const percent = Math.round((current / limit) * 100);
    const shouldAlert = direction === "max" ? percent > 100 : current < limit;
    if (!shouldAlert) {
      return null;
    }

    const severity: DashboardAlertSeverity = direction === "max" ? "critical" : "warning";
    const type: DashboardAlertType = direction === "max" ? "red" : "yellow";
    const roundedCurrent = this.roundValue(current);
    const roundedLimit = this.roundValue(limit);
    const unit = threshold?.unit || "";
    return {
      id: `${dateKey}:${rule.nutrientType}:${direction}`,
      type,
      severity,
      nutrientType: rule.nutrientType,
      title: direction === "max" ? `High ${rule.label}` : `Low ${rule.label}`,
      message: this.messageFor(rule, direction, roundedCurrent, roundedLimit, unit),
      current: roundedCurrent,
      limit: roundedLimit,
      unit,
      percent,
      isRead: false,
    };
  }

  private isConditionThreshold(t: UserNutritionalThresholdEntity | undefined): boolean {
    return t?.origin === "admin_rule" || t?.sourceConditionKey != null;
  }

  private indexThresholds(
    thresholds: UserNutritionalThresholdEntity[],
  ): Map<string, UserNutritionalThresholdEntity> {
    const rows = new Map<string, UserNutritionalThresholdEntity>();
    for (const threshold of thresholds) {
      const key = this.normalizeNutrientKey(threshold.nutrient);
      if (key && !rows.has(key)) {
        rows.set(key, threshold);
      }
      if ((key === "dietaryfiber" || key === "dietaryfibers") && !rows.has("fiber")) {
        rows.set("fiber", threshold);
      }
    }
    return rows;
  }

  private normalizeNutrientKey(value: string | null | undefined): string {
    return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  private messageFor(
    rule: AlertRule,
    direction: AlertDirection,
    current: number,
    limit: number,
    unit: string,
  ): string {
    const unitSuffix = unit ? ` ${unit}` : "";
    if (direction === "min") {
      return `${rule.label} is below your daily target (${current}/${limit}${unitSuffix}).`;
    }
    return `${rule.label} exceeded your daily limit (${current}/${limit}${unitSuffix}).`;
  }

  private roundValue(value: number): number {
    return Math.round(value * 10) / 10;
  }

  /** Returns true if the nutrient is relevant to any of the user's conditions. */
  private matchesUserCondition(nutrientType: string, conditionKeys: string[]): boolean {
    if (conditionKeys.length === 0) return false;
    const normalized = this.normalizeNutrientKey(nutrientType);
    for (const key of conditionKeys) {
      const nutrients = this.conditionNutrients.get(key.trim().toLowerCase());
      if (nutrients?.has(normalized)) return true;
    }
    return false;
  }
}
