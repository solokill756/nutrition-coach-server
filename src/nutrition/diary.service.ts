import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between, In } from "typeorm";
import { LogFoodEntity } from "./entities/log-food.entity";
import { DailyDiaryStatusEntity } from "./entities/daily-diary-status.entity";
import { WaterLogEntity } from "./entities/water-log.entity";
import { LogFoodService } from "./log-food.service";
import { ExerciseLogEntity } from "../exercise-logs/entities/exercise-log.entity";
import { ExerciseEntity } from "../exercises/entities/exercise.entity";
import { HydrationTargetService } from "../common/hydration/hydration-target.service";
import { UserGoalEntity } from "./entities/user-goal.entity";
import {
  calendarDayBounds,
  eachCalendarDateKey,
  localDateKeyFromInstant,
} from "../common/date/calendar-day-bounds";

/** Same default as dashboard.service — keeps diary + dashboard calorie budget aligned. */
const DEFAULT_CAL_TARGET = 2300;

const MICRO_TOTAL_FIELDS = [
  { logProp: "calciumMg", totalKey: "totalCalciumMg", aggKey: "calcium" },
  { logProp: "ironMg", totalKey: "totalIronMg", aggKey: "iron" },
  { logProp: "magnesiumMg", totalKey: "totalMagnesiumMg", aggKey: "magnesium" },
  { logProp: "phosphorusMg", totalKey: "totalPhosphorusMg", aggKey: "phosphorus" },
  { logProp: "zincMg", totalKey: "totalZincMg", aggKey: "zinc" },
  { logProp: "vitaminAUg", totalKey: "totalVitaminAUg", aggKey: "vitaminA" },
  { logProp: "vitaminCMg", totalKey: "totalVitaminCMg", aggKey: "vitaminC" },
  { logProp: "vitaminDUg", totalKey: "totalVitaminDUg", aggKey: "vitaminD" },
  { logProp: "vitaminEMg", totalKey: "totalVitaminEMg", aggKey: "vitaminE" },
  { logProp: "vitaminKUg", totalKey: "totalVitaminKUg", aggKey: "vitaminK" },
  { logProp: "vitaminB6Mg", totalKey: "totalVitaminB6Mg", aggKey: "vitaminB6" },
  { logProp: "vitaminB12Ug", totalKey: "totalVitaminB12Ug", aggKey: "vitaminB12" },
  { logProp: "folateDfeUg", totalKey: "totalFolateDfeUg", aggKey: "folateDfe" },
] as const;

type MicroLogProp = (typeof MICRO_TOTAL_FIELDS)[number]["logProp"];
type MicroAggKey = (typeof MICRO_TOTAL_FIELDS)[number]["aggKey"];

/** One calendar day's aggregated nutrition data — returned by getRange(). */
export interface DiaryDaySummary {
  date: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  totalSodiumMg: number;
  totalDietaryFibersG: number;
  totalSugarsG: number;
  totalSaturatedFatG: number;
  totalCholesterolMg: number;
  totalPotassiumMg: number;
  totalCalciumMg: number;
  totalIronMg: number;
  totalMagnesiumMg: number;
  totalPhosphorusMg: number;
  totalZincMg: number;
  totalVitaminAUg: number;
  totalVitaminCMg: number;
  totalVitaminDUg: number;
  totalVitaminEMg: number;
  totalVitaminKUg: number;
  totalVitaminB6Mg: number;
  totalVitaminB12Ug: number;
  totalFolateDfeUg: number;
  exerciseCaloriesBurned: number;
}

@Injectable()
export class DiaryService {
  constructor(
    @InjectRepository(LogFoodEntity)
    private readonly logRepo: Repository<LogFoodEntity>,
    @InjectRepository(DailyDiaryStatusEntity)
    private readonly statusRepo: Repository<DailyDiaryStatusEntity>,
    @InjectRepository(WaterLogEntity)
    private readonly waterRepo: Repository<WaterLogEntity>,
    @InjectRepository(ExerciseLogEntity)
    private readonly exerciseLogRepo: Repository<ExerciseLogEntity>,
    @InjectRepository(ExerciseEntity)
    private readonly exerciseRepo: Repository<ExerciseEntity>,
    @InjectRepository(UserGoalEntity)
    private readonly goalRepo: Repository<UserGoalEntity>,
    private readonly logFoodService: LogFoodService,
    private readonly hydrationTargetService: HydrationTargetService,
  ) {}

  private async resolveTargetCalories(userId: number): Promise<number> {
    const activeGoal = await this.goalRepo.findOne({
      where: { userId, isActive: true },
      order: { startDate: "DESC" },
    });
    return Math.round(
      activeGoal?.targetCalories != null && Number.isFinite(activeGoal.targetCalories)
        ? activeGoal.targetCalories
        : DEFAULT_CAL_TARGET,
    );
  }

  private dayBounds(dateKey: string, tzOffsetMinutes = 0): { start: Date; end: Date } {
    return calendarDayBounds(dateKey, tzOffsetMinutes);
  }

  async getDay(
    userId: number,
    dateKey: string,
    tzOffsetMinutes = 0,
  ): Promise<Record<string, unknown>> {
    const { start, end } = this.dayBounds(dateKey, tzOffsetMinutes);
    const dateStr = dateKey.slice(0, 10);

    // Batch 1: Parallel independent queries (LogFood, Status, Water, UserGoal)
    const [rows, status, water, targetCalories] = await Promise.all([
      this.logRepo.find({
        where: { userId, delFlag: false, loggedAt: Between(start, end) },
        order: { loggedAt: "ASC" },
      }),
      this.statusRepo.findOne({ where: { userId, date: dateStr } }),
      this.waterRepo.findOne({ where: { userId, date: dateStr, delFlag: false } }),
      this.resolveTargetCalories(userId),
    ]);

    const apiItems = await this.logFoodService.mapRowsToApiItems(rows);

    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let totalSodiumMg = 0;
    let totalDietaryFibersG = 0;
    let totalSugarsG = 0;
    let totalSaturatedFatG = 0;
    let totalCholesterolMg = 0;
    let totalPotassiumMg = 0;
    const microTotals = MICRO_TOTAL_FIELDS.reduce(
      (acc, field) => ({ ...acc, [field.totalKey]: 0 }),
      {} as Record<(typeof MICRO_TOTAL_FIELDS)[number]["totalKey"], number>,
    );

    const breakfast: unknown[] = [];
    const lunch: unknown[] = [];
    const dinner: unknown[] = [];
    const snacks: unknown[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const item = apiItems[i];
      totalCalories += Number(r.calories) || 0;
      totalProtein += Number(r.proteinG) || 0;
      totalCarbs += Number(r.totalCarbohydratesG) || 0;
      totalFat += Number(r.totalFatG) || 0;
      totalSodiumMg += Number(r.sodiumMg) || 0;
      totalDietaryFibersG += Number(r.dietaryFibersG) || 0;
      totalSugarsG += Number(r.sugarsG) || 0;
      totalSaturatedFatG += Number(r.saturatedFatG) || 0;
      totalCholesterolMg += Number(r.cholesterolMg) || 0;
      totalPotassiumMg += Number(r.potassiumMg) || 0;
      for (const field of MICRO_TOTAL_FIELDS) {
        microTotals[field.totalKey] += Number(r[field.logProp as MicroLogProp]) || 0;
      }
      const slug = this.logFoodService.mealIntToSlug(r.meal);
      if (slug === "lunch") lunch.push(item);
      else if (slug === "dinner") dinner.push(item);
      else if (slug === "snack") snacks.push(item);
      else breakfast.push(item);
    }

    const amountMl = water?.amountMl != null ? Number(water.amountMl) : 0;
    const targetMl = await this.hydrationTargetService.getTargetMlForUser(userId);

    const exerciseLogs = await this.exerciseLogRepo.find({
      where: { userId, delFlag: false, startedAt: Between(start, end) },
      order: { startedAt: "DESC" },
    });
    const exerciseIds = [...new Set(exerciseLogs.map((l) => Number(l.exerciseId)))];
    const exercises =
      exerciseIds.length === 0
        ? []
        : await this.exerciseRepo.find({
            where: { id: In(exerciseIds), delFlag: false },
          });
    const exById = new Map(exercises.map((e) => [Number(e.id), e]));

    let exerciseCaloriesBurned = 0;
    const exercisesPayload: Array<{
      id: string;
      name: string;
      caloriesBurned: number;
      duration: number;
    }> = [];

    for (const log of exerciseLogs) {
      const cals = Number(log.caloriesBurned) || 0;
      exerciseCaloriesBurned += cals;
      const mins = Number(log.minutesPerformed) || 0;
      const ex = exById.get(Number(log.exerciseId));
      exercisesPayload.push({
        id: String(log.id),
        name: ex?.name ?? "Exercise",
        caloriesBurned: Math.round(cals),
        duration: Math.round(mins),
      });
    }

    const roundedTotalCalories = Math.round(totalCalories);
    const roundedExerciseBurned = Math.round(exerciseCaloriesBurned);
    const caloriesRemaining = targetCalories - roundedTotalCalories + roundedExerciseBurned;

    return {
      date: dateKey.slice(0, 10),
      targetCalories,
      caloriesRemaining,
      totalCalories: roundedTotalCalories,
      totalProtein: totalProtein,
      totalCarbs: totalCarbs,
      totalFat: totalFat,
      totalSodiumMg: totalSodiumMg,
      totalDietaryFibersG: totalDietaryFibersG,
      totalSugarsG,
      totalSaturatedFatG,
      totalCholesterolMg,
      totalPotassiumMg,
      ...microTotals,
      exerciseCaloriesBurned: roundedExerciseBurned,
      exercises: exercisesPayload,
      isCompleted: status?.isCompleted ?? false,
      note: status?.note ?? null,
      mealGroups: [
        { mealType: "breakfast", logs: breakfast },
        { mealType: "lunch", logs: lunch },
        { mealType: "dinner", logs: dinner },
        { mealType: "snacks", logs: snacks },
      ],
      waterLog: { amountMl, targetMl },
    };
  }

  async getRange(
    userId: number,
    fromKey: string,
    toKey: string,
    tzOffsetMinutes = 0,
  ): Promise<DiaryDaySummary[]> {
    const { start: fromStart } = calendarDayBounds(fromKey, tzOffsetMinutes);
    const { end: toEnd } = calendarDayBounds(toKey, tzOffsetMinutes);
    const rows = await this.logRepo.find({
      where: { userId, delFlag: false, loggedAt: Between(fromStart, toEnd) },
    });

    const exLogs = await this.exerciseLogRepo.find({
      where: { userId, delFlag: false, startedAt: Between(fromStart, toEnd) },
    });
    const burnedByDay = new Map<string, number>();
    for (const log of exLogs) {
      const d = localDateKeyFromInstant(
        log.startedAt instanceof Date ? log.startedAt : new Date(log.startedAt),
        tzOffsetMinutes,
      );
      const c = Number(log.caloriesBurned) || 0;
      burnedByDay.set(d, (burnedByDay.get(d) ?? 0) + c);
    }

    const byDay = new Map<string, {
      cal: number;
      p: number;
      c: number;
      f: number;
      na: number;
      fib: number;
      sugar: number;
      satFat: number;
      chol: number;
      potassium: number;
      micro: Record<MicroAggKey, number>;
    }>();
    for (const r of rows) {
      const d = localDateKeyFromInstant(
        r.loggedAt instanceof Date ? r.loggedAt : new Date(r.loggedAt),
        tzOffsetMinutes,
      );
      const cur = byDay.get(d) ?? {
        cal: 0,
        p: 0,
        c: 0,
        f: 0,
        na: 0,
        fib: 0,
        sugar: 0,
        satFat: 0,
        chol: 0,
        potassium: 0,
        micro: MICRO_TOTAL_FIELDS.reduce(
          (acc, field) => ({ ...acc, [field.aggKey]: 0 }),
          {} as Record<MicroAggKey, number>,
        ),
      };
      cur.cal += Number(r.calories) || 0;
      cur.p += Number(r.proteinG) || 0;
      cur.c += Number(r.totalCarbohydratesG) || 0;
      cur.f += Number(r.totalFatG) || 0;
      cur.na += Number(r.sodiumMg) || 0;
      cur.fib += Number(r.dietaryFibersG) || 0;
      cur.sugar += Number(r.sugarsG) || 0;
      cur.satFat += Number(r.saturatedFatG) || 0;
      cur.chol += Number(r.cholesterolMg) || 0;
      cur.potassium += Number(r.potassiumMg) || 0;
      for (const field of MICRO_TOTAL_FIELDS) {
        cur.micro[field.aggKey] += Number(r[field.logProp as MicroLogProp]) || 0;
      }
      byDay.set(d, cur);
    }

    const out: DiaryDaySummary[] = [];
    for (const d of eachCalendarDateKey(fromKey, toKey)) {
      const agg = byDay.get(d);
      const micro = MICRO_TOTAL_FIELDS.reduce(
        (acc, field) => ({
          ...acc,
          [field.totalKey]: agg?.micro[field.aggKey] ?? 0,
        }),
        {} as Record<(typeof MICRO_TOTAL_FIELDS)[number]["totalKey"], number>,
      );
      out.push({
        date: d,
        totalCalories: Math.round(agg?.cal ?? 0),
        totalProtein: agg?.p ?? 0,
        totalCarbs: agg?.c ?? 0,
        totalFat: agg?.f ?? 0,
        totalSodiumMg: agg?.na ?? 0,
        totalDietaryFibersG: agg?.fib ?? 0,
        totalSugarsG: agg?.sugar ?? 0,
        totalSaturatedFatG: agg?.satFat ?? 0,
        totalCholesterolMg: agg?.chol ?? 0,
        totalPotassiumMg: agg?.potassium ?? 0,
        ...micro,
        exerciseCaloriesBurned: Math.round(burnedByDay.get(d) ?? 0),
      });
    }
    return out;
  }

  async setCompleted(userId: number, dateIso: string, isCompleted: boolean): Promise<void> {
    const date = new Date(dateIso);
    const dateKey = Number.isFinite(date.getTime())
      ? date.toISOString().slice(0, 10)
      : dateIso.trim().slice(0, 10);

    let row = await this.statusRepo.findOne({ where: { userId, date: dateKey } });
    if (!row) {
      row = this.statusRepo.create({
        userId,
        date: dateKey,
        isCompleted,
      });
    } else {
      row.isCompleted = isCompleted;
      row.updatedAt = new Date();
    }
    await this.statusRepo.save(row);
  }

  async setNote(userId: number, dateIso: string, note: string | null): Promise<void> {
    const date = new Date(dateIso);
    const dateKey = Number.isFinite(date.getTime())
      ? date.toISOString().slice(0, 10)
      : dateIso.trim().slice(0, 10);
    const normalized = note?.trim() ?? "";

    let row = await this.statusRepo.findOne({ where: { userId, date: dateKey } });
    if (!row) {
      row = this.statusRepo.create({
        userId,
        date: dateKey,
        isCompleted: false,
        note: normalized.length === 0 ? null : normalized,
      });
    } else {
      row.note = normalized.length === 0 ? null : normalized;
      row.updatedAt = new Date();
    }
    await this.statusRepo.save(row);
  }
}
