import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { Between } from "typeorm";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { NutritionCalculatorService } from "../nutrition/nutrition-calculator.service";
import { UserThresholdBuilderService } from "../nutrition/user-threshold-builder.service";
import { UserThresholdPersistenceService } from "../nutrition/user-threshold-persistence.service";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { UserHealthConditionEntity } from "../nutrition/entities/user-health-condition.entity";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";
import { WeightEntity } from "./entities/weight.entity";
import { CreateWeightDto } from "./dto/create-weight.dto";
import { UpdateWeightDto } from "./dto/update-weight.dto";
import { WeightItemResponseDto } from "./dto/weight-item-response.dto";
import { WeightListResponseDto } from "./dto/weight-list-response.dto";

import { localDateKeyFromInstant } from "../common/date/calendar-day-bounds";

function parseRecordedAt(raw: string): Date {
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) {
    throw new BadRequestException("Invalid recordedAt");
  }
  return new Date(t);
}

@Injectable()
export class WeightService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly nutritionCalculator: NutritionCalculatorService,
    private readonly thresholdBuilder: UserThresholdBuilderService,
    private readonly thresholdPersistence: UserThresholdPersistenceService,
    @InjectRepository(WeightEntity)
    private readonly weightRepo: Repository<WeightEntity>,
    @InjectRepository(AppUserEntity)
    private readonly userRepo: Repository<AppUserEntity>,
    @InjectRepository(UserGoalEntity)
    private readonly goalRepo: Repository<UserGoalEntity>,
    @InjectRepository(UserNutritionalThresholdEntity)
    private readonly thresholdRepo: Repository<UserNutritionalThresholdEntity>,
  ) {}

  toApiItem(e: WeightEntity): WeightItemResponseDto {
    return {
      id: Number(e.id),
      weightKg: Number(e.weightKg),
      recordedAt: (e.recordedAt instanceof Date ? e.recordedAt : new Date(e.recordedAt)).toISOString(),
      photoUrl: e.photoUrl ?? undefined,
    };
  }

  async list(
    userId: number,
    page: number,
    pageSize: number,
    startDate?: string,
    endDate?: string,
  ): Promise<WeightListResponseDto> {
    const qb = this.weightRepo
      .createQueryBuilder("w")
      .where("w.userId = :userId", { userId })
      .andWhere("w.delFlag = false");

    if (startDate?.trim()) {
      const s = startDate.trim().slice(0, 10);
      qb.andWhere("w.recordedOn >= :start", { start: s });
    }
    if (endDate?.trim()) {
      const e = endDate.trim().slice(0, 10);
      qb.andWhere("w.recordedOn <= :end", { end: e });
    }

    const total = await qb.clone().getCount();
    const user = await this.userRepo.findOne({
      where: { id: userId, delFlag: false },
      select: ["id", "weight", "startWeight"],
    });
    const startValue = this.resolveStartWeightKg(user);

    const latestRow = await this.weightRepo
      .createQueryBuilder("w")
      .where("w.userId = :userId", { userId })
      .andWhere("w.delFlag = false")
      .orderBy("w.recordedAt", "DESC")
      .take(1)
      .getOne();
    const currentValue = latestRow
      ? Number(latestRow.weightKg)
      : startValue > 0
        ? startValue
        : 0;
    const changeValue = startValue !== 0 ? currentValue - startValue : 0;
    const changePercentage = startValue !== 0 ? (changeValue / startValue) * 100 : 0;

    qb.orderBy("w.recordedAt", "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const rows = await qb.getMany();
    return {
      items: rows.map((r) => this.toApiItem(r)),
      total,
      stats: { startValue, currentValue, changeValue, changePercentage },
    };
  }

  private resolveStartWeightKg(
    user: Pick<AppUserEntity, "weight" | "startWeight"> | null,
  ): number {
    const start = user?.startWeight;
    if (start != null && Number.isFinite(Number(start)) && Number(start) > 0) {
      return Number(start);
    }
    const weight = user?.weight;
    if (weight != null && Number.isFinite(Number(weight))) {
      return Number(weight);
    }
    return 0;
  }

  async getOne(userId: number, id: number): Promise<WeightItemResponseDto> {
    const row = await this.weightRepo.findOne({ where: { id, userId, delFlag: false } });
    if (!row) {
      throw new NotFoundException("Weight entry not found");
    }
    return this.toApiItem(row);
  }

  async saveEntry(params: {
    userId: number;
    weightKg?: number;
    recordedAt?: Date;
    photoUrl?: string | null;
    existingId?: number;
    tzOffsetMinutes?: number;
  }): Promise<WeightEntity> {
    const {
      userId,
      weightKg,
      recordedAt,
      photoUrl,
      existingId,
      tzOffsetMinutes = 0,
    } = params;

    return this.dataSource.transaction(async (manager) => {
      const weightRepo = manager.getRepository(WeightEntity);

      let row: WeightEntity | null = null;
      if (existingId != null) {
        row = await weightRepo.findOne({ where: { id: existingId, userId, delFlag: false } });
        if (!row) {
          throw new NotFoundException("Weight entry not found");
        }

        const finalWeight = weightKg ?? Number(row.weightKg);
        const finalRecordedAt =
          recordedAt ??
          (row.recordedAt instanceof Date ? row.recordedAt : new Date(row.recordedAt));
        if (!Number.isFinite(finalWeight) || finalWeight <= 0) {
          throw new BadRequestException("weightKg must be positive");
        }

        const recordedOn = localDateKeyFromInstant(finalRecordedAt, tzOffsetMinutes);
        const now = new Date();
        row.weightKg = finalWeight.toFixed(2);
        row.recordedAt = finalRecordedAt;
        row.recordedOn = recordedOn;
        if (photoUrl !== undefined) {
          row.photoUrl = photoUrl;
        }
        row.updatedAt = now;
        row = await weightRepo.save(row);

        await this.recalculateGoalTargetsFromLatestWeight(userId, finalWeight, manager);
        return row;
      }

      if (weightKg == null || recordedAt == null) {
        throw new BadRequestException("weightKg and recordedAt are required");
      }
      if (!Number.isFinite(weightKg) || weightKg <= 0) {
        throw new BadRequestException("weightKg must be positive");
      }

      const recordedOn = localDateKeyFromInstant(recordedAt, tzOffsetMinutes);
      row = await weightRepo.findOne({
        where: { userId, recordedOn, delFlag: false },
      });

      const now = new Date();
      if (!row) {
        row = weightRepo.create({
          userId,
          weightKg: weightKg.toFixed(2),
          recordedAt,
          recordedOn,
          photoUrl: photoUrl ?? null,
          caption: null,
          createdAt: now,
          updatedAt: now,
          delFlag: false,
        });
        row = await weightRepo.save(row);
      } else {
        row.weightKg = weightKg.toFixed(2);
        row.recordedAt = recordedAt;
        row.recordedOn = recordedOn;
        if (photoUrl !== undefined) {
          row.photoUrl = photoUrl;
        }
        row.updatedAt = now;
        row = await weightRepo.save(row);
      }

      await this.recalculateGoalTargetsFromLatestWeight(userId, weightKg, manager);

      return row;
    });
  }

  async create(
    userId: number,
    body: CreateWeightDto,
    tzOffsetMinutes = 0,
  ): Promise<WeightItemResponseDto> {
    const w = typeof body.weightKg === "string" ? Number(body.weightKg) : body.weightKg;
    const recordedAt = parseRecordedAt(body.recordedAt);
    const saved = await this.saveEntry({
      userId,
      weightKg: w,
      recordedAt,
      photoUrl: body.photoUrl,
      tzOffsetMinutes,
    });
    return this.toApiItem(saved);
  }

  async update(
    userId: number,
    id: number,
    body: UpdateWeightDto,
    tzOffsetMinutes = 0,
  ): Promise<{ ok: boolean }> {
    await this.saveEntry({
      userId,
      weightKg: body.weightKg,
      recordedAt: body.recordedAt != null ? parseRecordedAt(body.recordedAt) : undefined,
      photoUrl: body.photoUrl,
      existingId: id,
      tzOffsetMinutes,
    });
    return { ok: true };
  }

  /** Latest weight per calendar day (UTC date key) in inclusive range — for trends / dashboard. */
  async latestByDay(userId: number, fromKey: string, toKey: string): Promise<Map<string, number>> {
    const from = fromKey.slice(0, 10);
    const to = toKey.slice(0, 10);
    const rows = await this.weightRepo.find({
      where: { userId, delFlag: false, recordedOn: Between(from, to) },
      order: { recordedAt: "ASC" },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      const d = String(r.recordedOn).slice(0, 10);
      map.set(d, Number(r.weightKg));
    }
    return map;
  }

  async hasEntryOnDate(userId: number, dateKey: string): Promise<boolean> {
    const d = dateKey.slice(0, 10);
    const n = await this.weightRepo.count({
      where: { userId, recordedOn: d, delFlag: false },
    });
    return n > 0;
  }

  async historyDescending(userId: number, limit: number): Promise<WeightEntity[]> {
    return this.weightRepo.find({
      where: { userId, delFlag: false },
      order: { recordedOn: "DESC", recordedAt: "DESC" },
      take: limit,
    });
  }

  private async recalculateGoalTargetsFromLatestWeight(
    userId: number,
    currentWeightKg: number,
    manager: EntityManager,
  ): Promise<void> {
    const userRepo = manager.getRepository(AppUserEntity);
    const goalRepo = manager.getRepository(UserGoalEntity);

    const [user, activeGoal] = await Promise.all([
      userRepo.findOne({ where: { id: userId, delFlag: false } }),
      goalRepo.findOne({ where: { userId, isActive: true } }),
    ]);
    if (!user || !activeGoal) {
      throw new BadRequestException(
        "Cannot recalculate nutrition targets: no active goal found for user",
      );
    }

    const goalType = this.nutritionCalculator.normalizeGoalType(activeGoal.goalType);
    const basePlan = this.nutritionCalculator.computeNutritionPlan({
      gender: user.sex,
      age: user.age,
      heightCm: user.height,
      currentWeightKg,
      activityLevel: user.fitnessLevel,
      goalType,
    });

    const adjustedCalories = basePlan.targetCalories;

    const healthRows = await manager.getRepository(UserHealthConditionEntity).find({
      where: { userId, isActive: true },
    });
    const conditionTypes = healthRows.map((row) => row.conditionName);

    const macros = this.nutritionCalculator.macroBreakdownForGoal({
      gender: user.sex,
      age: user.age,
      heightCm: user.height,
      currentWeightKg,
      activityLevel: user.fitnessLevel,
      goalType,
      targetCalories: adjustedCalories,
    });

    if (user.startWeight == null || user.startWeight <= 0) {
      const priorWeight =
        user.weight != null && Number.isFinite(Number(user.weight)) && Number(user.weight) > 0
          ? Number(user.weight)
          : null;
      if (priorWeight != null) {
        user.startWeight = priorWeight;
      }
    }
    user.weight = currentWeightKg;
    user.updatedAt = new Date();
    activeGoal.targetCalories = adjustedCalories;
    activeGoal.updatedAt = new Date();
    await userRepo.save(user);
    await goalRepo.save(activeGoal);

    const { thresholds: rows } = await this.thresholdBuilder.build({
      userId,
      targetCalories: adjustedCalories,
      macroCenter: macros,
      conditionTypes,
      gender: user.sex ?? null,
      allowAutoRebalance: true,
      bodyWeightKg: currentWeightKg ?? undefined,
    });
    await this.thresholdPersistence.replaceUserThresholds(manager, userId, rows);
  }
}
