import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { ConditionNutrientUnitService } from "./condition-nutrient-unit.service";
import { UserNutritionalThresholdEntity } from "./entities/user-nutritional-threshold.entity";

@Injectable()
export class UserThresholdPersistenceService {
  constructor(private readonly units: ConditionNutrientUnitService) {}

  /**
   * Upsert thresholds by (userId, nutrient). DB enforces one row per nutrient per user;
   * callers must not deactivate + insert.
   */
  async replaceUserThresholds(
    manager: EntityManager,
    userId: number,
    rows: Array<Partial<UserNutritionalThresholdEntity>>,
  ): Promise<void> {
    const thresholdRepo = manager.getRepository(UserNutritionalThresholdEntity);
    const existing = await thresholdRepo.find({ where: { userId } });
    const existingByNutrient = new Map<string, UserNutritionalThresholdEntity>();
    for (const row of existing) {
      existingByNutrient.set(this.units.normalizeNutrient(row.nutrient), row);
    }

    const now = new Date();
    const touched = new Set<string>();
    const toSave: UserNutritionalThresholdEntity[] = [];
    const deduped = this.dedupeByNutrient(rows);

    for (const input of deduped) {
      const nutrient = String(input.nutrient ?? "").trim();
      if (!nutrient) continue;

      const key = this.units.normalizeNutrient(nutrient);
      touched.add(key);

      const current = existingByNutrient.get(key);
      if (current) {
        this.applyThresholdFields(current, input, now);
        toSave.push(current);
        continue;
      }

      toSave.push(
        thresholdRepo.create({
          userId,
          nutrient,
          minAmount: input.minAmount ?? null,
          maxAmount: input.maxAmount ?? null,
          unit: input.unit ?? "g",
          isActive: input.isActive ?? true,
          origin: input.origin ?? "system",
          sourceConditionKey: input.sourceConditionKey ?? null,
          sourceRuleId: input.sourceRuleId ?? null,
          isCustomized: input.isCustomized ?? false,
          previousCustomMinAmount: input.previousCustomMinAmount ?? null,
          previousCustomMaxAmount: input.previousCustomMaxAmount ?? null,
          previousCustomUnit: input.previousCustomUnit ?? null,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    for (const row of existing) {
      const key = this.units.normalizeNutrient(row.nutrient);
      if (!touched.has(key) && row.isActive) {
        row.isActive = false;
        row.updatedAt = now;
        toSave.push(row);
      }
    }

    if (toSave.length > 0) {
      await thresholdRepo.save(toSave);
    }
  }

  private dedupeByNutrient(
    rows: Array<Partial<UserNutritionalThresholdEntity>>,
  ): Array<Partial<UserNutritionalThresholdEntity>> {
    const byNutrient = new Map<string, Partial<UserNutritionalThresholdEntity>>();
    for (const row of rows) {
      const nutrient = String(row.nutrient ?? "").trim();
      if (!nutrient) continue;
      byNutrient.set(this.units.normalizeNutrient(nutrient), row);
    }
    return [...byNutrient.values()];
  }

  private applyThresholdFields(
    target: UserNutritionalThresholdEntity,
    input: Partial<UserNutritionalThresholdEntity>,
    now: Date,
  ): void {
    if (input.nutrient != null && String(input.nutrient).trim()) {
      target.nutrient = String(input.nutrient).trim();
    }
    if (input.minAmount !== undefined) target.minAmount = input.minAmount;
    if (input.maxAmount !== undefined) target.maxAmount = input.maxAmount;
    if (input.unit != null) target.unit = input.unit;
    if (input.isActive !== undefined) target.isActive = input.isActive;
    if (input.origin != null) target.origin = input.origin;
    if (input.sourceConditionKey !== undefined) {
      target.sourceConditionKey = input.sourceConditionKey;
    }
    if (input.sourceRuleId !== undefined) target.sourceRuleId = input.sourceRuleId;
    if (input.isCustomized !== undefined) target.isCustomized = input.isCustomized;
    if (input.previousCustomMinAmount !== undefined) {
      target.previousCustomMinAmount = input.previousCustomMinAmount;
    }
    if (input.previousCustomMaxAmount !== undefined) {
      target.previousCustomMaxAmount = input.previousCustomMaxAmount;
    }
    if (input.previousCustomUnit !== undefined) {
      target.previousCustomUnit = input.previousCustomUnit;
    }
    target.isActive = input.isActive ?? true;
    target.updatedAt = now;
  }
}
