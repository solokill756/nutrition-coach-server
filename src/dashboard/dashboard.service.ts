import { Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import NodeCache from "node-cache";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { ExerciseLogEntity } from "../exercise-logs/entities/exercise-log.entity";
import { LogFoodEntity } from "../nutrition/entities/log-food.entity";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { UserHealthConditionEntity } from "../nutrition/entities/user-health-condition.entity";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";
import { calendarDayBounds, resolveClientDateKey } from "../common/date/calendar-day-bounds";
import { HydrationTargetService } from "../common/hydration/hydration-target.service";
import { WaterLogEntity } from "../nutrition/entities/water-log.entity";
import { DiaryService } from "../nutrition/diary.service";
import { NutritionCalculatorService } from "../nutrition/nutrition-calculator.service";
import { UserContextService } from "../nutrition/user-context.service";
import { WeightEntity } from "../weight/entities/weight.entity";
import { WeightService } from "../weight/weight.service";
import {
  DashboardAlertService,
  DashboardDailyTotals,
  DashboardAlert,
  DashboardHealthNutrients,
} from "./dashboard-alert.service";
import { DashboardAiService, DashboardAiSuggestion, DashboardAiSuggestionContext } from "./dashboard-ai.service";
import { DashboardEventBus, DiaryChangedEvent } from "./dashboard-event-bus";

function dayBounds(dateKey: string, tzOffsetMinutes = 0): { start: Date; end: Date } {
  return calendarDayBounds(dateKey, tzOffsetMinutes);
}

const DEFAULT_CAL_TARGET = 2300;

export type DashboardCaloriesStatus = "on_track" | "close" | "exceeded";

export interface DashboardTodayResponse {
  date: string;
  user: {
    id: number;
    displayName: string;
    avatarUrl: string | null;
  };
  calories: {
    target: number;
    consumed: number;
    burned: number;
    net: number;
    remaining: number;
    status: DashboardCaloriesStatus;
  };
  macros: {
    protein: { current: number; target: number };
    carbs: { current: number; target: number };
    fat: { current: number; target: number };
  };
  exercise: {
    caloriesBurned: number;
    minutes: number;
    workoutCount: number;
  };
  water: {
    currentMl: number;
    targetMl: number;
  };
  weight: {
    startKg: number | null;
    currentKg: number | null;
    goalKg: number | null;
    totalChangeKg: number;
    weeklyChangeKg: number;
    history: Array<{ date: string; weightKg: number }>;
  };
  alerts: DashboardAlert[];
  aiSuggestion: {
    title: string;
    message: string;
  };
  checklist: {
    foodLogged: boolean;
    waterLogged: boolean;
    exerciseLogged: boolean;
    weightLogged: boolean;
    isCompleted: boolean;
  };
  healthNutrients: DashboardHealthNutrients;
  micronutrients: Record<string, number>;
}



@Injectable()
export class DashboardService implements OnModuleDestroy {
  private readonly suggestionCache = new NodeCache({ stdTTL: 0, checkperiod: 120 });
  private readonly invalidateFn: (event: DiaryChangedEvent) => void;

  constructor(
    @InjectRepository(AppUserEntity)
    private readonly userRepo: Repository<AppUserEntity>,
    @InjectRepository(UserGoalEntity)
    private readonly goalRepo: Repository<UserGoalEntity>,
    @InjectRepository(UserHealthConditionEntity)
    private readonly conditionRepo: Repository<UserHealthConditionEntity>,
    @InjectRepository(ExerciseLogEntity)
    private readonly exerciseLogRepo: Repository<ExerciseLogEntity>,
    @InjectRepository(WaterLogEntity)
    private readonly waterRepo: Repository<WaterLogEntity>,
    @InjectRepository(LogFoodEntity)
    private readonly logFoodRepo: Repository<LogFoodEntity>,
    @InjectRepository(UserNutritionalThresholdEntity)
    private readonly thresholdRepo: Repository<UserNutritionalThresholdEntity>,
    private readonly diaryService: DiaryService,
    private readonly nutritionCalculator: NutritionCalculatorService,
    private readonly weightService: WeightService,
    private readonly hydrationTargetService: HydrationTargetService,
    private readonly dashboardAlertService: DashboardAlertService,
    private readonly userContextService: UserContextService,
    private readonly dashboardAiService: DashboardAiService,
    private readonly dashboardEventBus: DashboardEventBus,
  ) {
    this.invalidateFn = (event) => this.invalidateSuggestionCache(event.userId, event.dateKey);
    this.dashboardEventBus.onDiaryChanged(this.invalidateFn);
  }

  onModuleDestroy(): void {
    this.dashboardEventBus.removeListener(this.invalidateFn);
    this.suggestionCache.close();
  }

  invalidateSuggestionCache(userId: number, dateKey: string): void {
    this.suggestionCache.del(`suggestion_${userId}_${dateKey}`);
  }

  async getTodayDashboard(
    userId: number,
    clientDate?: string,
    tzOffsetMinutes = 0,
  ): Promise<DashboardTodayResponse> {
    const dateKey = resolveClientDateKey(clientDate, tzOffsetMinutes);
    const base = await this.loadDashboardBase(userId, dateKey, tzOffsetMinutes);

    const foodCount = await this.logFoodRepo.count({
      where: { userId, delFlag: false, loggedAt: Between(base.start, base.end) },
    });

    const foodLogged = foodCount > 0;
    const waterLogged = base.currentMl > 0;
    const exerciseLogged = base.exerciseAgg.workoutCount > 0;
    const weightLogged = await this.weightService.hasEntryOnDate(userId, dateKey);

    const weightHist21 = await this.weightService.historyDescending(userId, 21);
    const history = [...weightHist21]
      .map((w) => ({
        date: String(w.recordedOn).slice(0, 10),
        weightKg: round1(Number(w.weightKg)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const startKgFromLog =
      weightHist21.length > 0
        ? round1(Number(weightHist21[weightHist21.length - 1].weightKg))
        : null;
    const profileStart =
      base.user.startWeight != null && Number.isFinite(Number(base.user.startWeight))
        ? round1(Number(base.user.startWeight))
        : base.user.weight != null && Number.isFinite(Number(base.user.weight))
          ? round1(Number(base.user.weight))
          : null;
    const startKg = profileStart ?? startKgFromLog;

    const currentKg =
      base.currentKgFromLog != null ? base.currentKgFromLog : startKg;
    const totalChangeKg = currentKg != null && startKg != null ? round1(currentKg - startKg) : 0;
    const weeklyChangeKg = this.computeWeeklyWeightDelta(weightHist21);

    const goalKg =
      base.user.goalWeight != null && Number.isFinite(Number(base.user.goalWeight)) ? Number(base.user.goalWeight) : null;

    const aiSuggestion = this.dashboardAiService.buildFallbackSuggestion({
      remaining: base.remaining,
      alerts: base.alerts,
      waterCurrentMl: base.currentMl,
      waterTargetMl: base.waterTargetMl,
      workoutCount: base.exerciseAgg.workoutCount,
    });

    return {
      date: dateKey,
      user: {
        id: Number(base.user.id),
        displayName: base.user.displayName,
        avatarUrl: base.user.avatarUrl,
      },
      calories: {
        target: base.targetCalories,
        consumed: base.consumed,
        burned: base.burned,
        net: base.net,
        remaining: base.remaining,
        status: base.status,
      },
      macros: {
        protein: { current: base.protein, target: round1(base.macroTargets.proteinG) },
        carbs: { current: base.carbs, target: round1(base.macroTargets.carbsG) },
        fat: { current: base.fat, target: round1(base.macroTargets.fatG) },
      },
      exercise: {
        caloriesBurned: base.burned,
        minutes: Math.round(base.exerciseAgg.minutes),
        workoutCount: base.exerciseAgg.workoutCount,
      },
      water: {
        currentMl: base.currentMl,
        targetMl: base.waterTargetMl,
      },
      weight: {
        startKg,
        currentKg,
        goalKg,
        totalChangeKg,
        weeklyChangeKg,
        history,
      },
      alerts: base.alerts,
      aiSuggestion,
      checklist: {
        foodLogged,
        waterLogged,
        exerciseLogged,
        weightLogged,
        isCompleted: foodLogged && waterLogged && exerciseLogged && weightLogged,
      },
      healthNutrients: this.dashboardAlertService.buildHealthNutrients(base.dailyTotals, base.thresholds),
      micronutrients: {
        calcium: base.dailyTotals.calcium,
        iron: base.dailyTotals.iron,
        magnesium: base.dailyTotals.magnesium,
        phosphorus: base.dailyTotals.phosphorus,
        zinc: base.dailyTotals.zinc,
        vitaminA: base.dailyTotals.vitaminA,
        vitaminC: base.dailyTotals.vitaminC,
        vitaminD: base.dailyTotals.vitaminD,
        vitaminE: base.dailyTotals.vitaminE,
        vitaminK: base.dailyTotals.vitaminK,
        vitaminB6: base.dailyTotals.vitaminB6,
        vitaminB12: base.dailyTotals.vitaminB12,
        folate: base.dailyTotals.folate,
      },
    };
  }

  async getTodaySuggestion(
    userId: number,
    clientDate?: string,
    tzOffsetMinutes = 0,
  ): Promise<DashboardAiSuggestion> {
    const dateKey = resolveClientDateKey(clientDate, tzOffsetMinutes);
    const cacheKey = `suggestion_${userId}_${dateKey}`;

    const cached = this.suggestionCache.get<DashboardAiSuggestion>(cacheKey);
    if (cached) {
      return cached;
    }

    const base = await this.loadDashboardBase(userId, dateKey, tzOffsetMinutes);

    const userContext = await this.userContextService.assembleRecipeGenerationContext(
      userId,
      dateKey,
      "breakfast",
      tzOffsetMinutes,
    );

    const ctx: DashboardAiSuggestionContext = {
      userContext,
      calories: {
        target: base.targetCalories,
        consumed: base.consumed,
        burned: base.burned,
        net: base.net,
        remaining: base.remaining,
        status: base.status,
      },
      macros: {
        protein: { current: base.protein, target: round1(base.macroTargets.proteinG) },
        carbs: { current: base.carbs, target: round1(base.macroTargets.carbsG) },
        fat: { current: base.fat, target: round1(base.macroTargets.fatG) },
      },
      exercise: {
        caloriesBurned: base.burned,
        minutes: Math.round(base.exerciseAgg.minutes),
        workoutCount: base.exerciseAgg.workoutCount,
      },
      water: {
        currentMl: base.currentMl,
        targetMl: base.waterTargetMl,
      },
      remaining: base.remaining,
      alerts: base.alerts,
    };

    const suggestion = await this.dashboardAiService.buildAiSuggestion(ctx);

    const ttl = this.secondsUntilEndOfDay();
    this.suggestionCache.set(cacheKey, suggestion, ttl);

    return suggestion;
  }

  private secondsUntilEndOfDay(): number {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 1000));
  }

  /**
   * Shared DB reads for both getTodayDashboard and getTodaySuggestion.
   * Every field not shared (conditions, foodCount, weight history, checklist) is built by the caller.
   */
  private async loadDashboardBase(
    userId: number,
    dateKey: string,
    tzOffsetMinutes = 0,
  ) {
    const { start, end } = dayBounds(dateKey, tzOffsetMinutes);

    const [
      user,
      activeGoal,
      dayPayload,
      exerciseAgg,
      waterRow,
      thresholds,
      weightOne,
      userConditions,
    ] = await Promise.all([
      this.userRepo.findOne({
        where: { id: userId, delFlag: false },
        select: [
          "id", "displayName", "avatarUrl", "sex", "weight", "startWeight",
          "goalWeight", "fitnessLevel", "dietType", "allergies",
        ],
      }),
      this.goalRepo.findOne({
        where: { userId, isActive: true },
        order: { startDate: "DESC", id: "DESC" },
      }),
      this.diaryService.getDay(userId, dateKey, tzOffsetMinutes),
      this.aggregateExercise(userId, start, end),
      this.waterRepo.findOne({
        where: { userId, date: dateKey, delFlag: false },
      }),
      this.thresholdRepo.find({
        where: { userId, isActive: true },
      }),
      this.weightService.historyDescending(userId, 1),
      this.conditionRepo.find({
        where: { userId, isActive: true },
      }),
    ]);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const dailyTotals = this.buildDailyTotals(dayPayload);
    const consumed = Math.round(dailyTotals.calories);
    const protein = round1(dailyTotals.protein);
    const carbs = round1(dailyTotals.carbs);
    const fat = round1(dailyTotals.fat);
    const targetCalories = Math.round(
      activeGoal?.targetCalories != null && Number.isFinite(activeGoal.targetCalories)
        ? activeGoal.targetCalories
        : DEFAULT_CAL_TARGET,
    );
    const macroTargets =
      this.nutritionCalculator.macroBreakdownFromThresholds(targetCalories, thresholds) ??
      this.nutritionCalculator.macroBreakdownFromTargetCalories(targetCalories);
    const burned = Math.round(exerciseAgg.caloriesBurned);
    const net = consumed - burned;
    const remaining = targetCalories - net;
    const status = this.calorieStatus(remaining);
    const currentMl = waterRow?.amountMl != null ? Math.round(Number(waterRow.amountMl)) : 0;
    const conditionKeys = (userConditions ?? [])
      .map((c) => String(c.conditionName || "").toLowerCase())
      .filter(Boolean);
    const alerts = this.dashboardAlertService.buildDailyAlerts(dateKey, dailyTotals, thresholds, conditionKeys);

    const currentKgFromLog = weightOne.length > 0 ? round1(Number(weightOne[0].weightKg)) : null;
    const userWeight = user.weight != null && Number.isFinite(Number(user.weight)) ? Number(user.weight) : null;
    const waterTargetMl = this.hydrationTargetService.calculateForProfile({
      weightKg: currentKgFromLog ?? userWeight,
      sex: user.sex,
      fitnessLevel: user.fitnessLevel,
    });

    return {
      start, end,
      user, activeGoal, exerciseAgg,
      thresholds,
      dailyTotals, consumed, protein, carbs, fat,
      targetCalories, macroTargets,
      burned, net, remaining, status,
      currentMl, alerts, currentKgFromLog, userWeight, waterTargetMl,
    };
  }

  private computeWeeklyWeightDelta(rows: WeightEntity[]): number {
    if (rows.length < 2) {
      return 0;
    }
    const sorted = [...rows].sort((a, b) => {
      const da = String(a.recordedOn).slice(0, 10);
      const db = String(b.recordedOn).slice(0, 10);
      if (da !== db) {
        return da.localeCompare(db);
      }
      return (a.recordedAt instanceof Date ? a.recordedAt : new Date(a.recordedAt)).getTime() -
        (b.recordedAt instanceof Date ? b.recordedAt : new Date(b.recordedAt)).getTime();
    });
    const last = sorted[sorted.length - 1];
    const lastDate = String(last.recordedOn).slice(0, 10);
    const weekBefore = addDaysUtcDateKey(lastDate, -7);
    let candidate: WeightEntity | undefined;
    for (const r of sorted) {
      const d = String(r.recordedOn).slice(0, 10);
      if (d <= weekBefore) {
        candidate = r;
      }
    }
    if (!candidate) {
      return 0;
    }
    return round1(Number(last.weightKg) - Number(candidate.weightKg));
  }

  private calorieStatus(remaining: number): DashboardCaloriesStatus {
    if (remaining < 0) return "exceeded";
    if (remaining <= 300) return "close";
    return "on_track";
  }

  private async aggregateExercise(
    userId: number,
    start: Date,
    end: Date,
  ): Promise<{ caloriesBurned: number; minutes: number; workoutCount: number }> {
    const raw = await this.exerciseLogRepo
      .createQueryBuilder("l")
      .select("COALESCE(SUM(CAST(l.caloriesBurned AS DOUBLE PRECISION)), 0)", "sumCal")
      .addSelect("COALESCE(SUM(CAST(l.minutesPerformed AS DOUBLE PRECISION)), 0)", "sumMin")
      .addSelect("COUNT(l.id)", "cnt")
      .where("l.userId = :uid", { uid: userId })
      .andWhere("l.delFlag = :df", { df: false })
      .andWhere("l.startedAt BETWEEN :start AND :end", { start, end })
      .getRawOne<{ sumCal: string; sumMin: string; cnt: string }>();

    return {
      caloriesBurned: Number(raw?.sumCal ?? 0),
      minutes: Number(raw?.sumMin ?? 0),
      workoutCount: Number(raw?.cnt ?? 0),
    };
  }

  private buildDailyTotals(dayPayload: Record<string, unknown>): DashboardDailyTotals {
    return {
      calories: this.numberFromPayload(dayPayload["totalCalories"]),
      protein: this.numberFromPayload(dayPayload["totalProtein"]),
      carbs: this.numberFromPayload(dayPayload["totalCarbs"]),
      fat: this.numberFromPayload(dayPayload["totalFat"]),
      sodium: this.numberFromPayload(dayPayload["totalSodiumMg"]),
      fiber: this.numberFromPayload(dayPayload["totalDietaryFibersG"]),
      sugars: this.numberFromPayload(dayPayload["totalSugarsG"]),
      saturatedFat: this.numberFromPayload(dayPayload["totalSaturatedFatG"]),
      cholesterol: this.numberFromPayload(dayPayload["totalCholesterolMg"]),
      potassium: this.numberFromPayload(dayPayload["totalPotassiumMg"]),
      calcium: this.numberFromPayload(dayPayload["totalCalciumMg"]),
      iron: this.numberFromPayload(dayPayload["totalIronMg"]),
      magnesium: this.numberFromPayload(dayPayload["totalMagnesiumMg"]),
      phosphorus: this.numberFromPayload(dayPayload["totalPhosphorusMg"]),
      zinc: this.numberFromPayload(dayPayload["totalZincMg"]),
      vitaminA: this.numberFromPayload(dayPayload["totalVitaminAUg"]),
      vitaminC: this.numberFromPayload(dayPayload["totalVitaminCMg"]),
      vitaminD: this.numberFromPayload(dayPayload["totalVitaminDUg"]),
      vitaminE: this.numberFromPayload(dayPayload["totalVitaminEMg"]),
      vitaminK: this.numberFromPayload(dayPayload["totalVitaminKUg"]),
      vitaminB6: this.numberFromPayload(dayPayload["totalVitaminB6Mg"]),
      vitaminB12: this.numberFromPayload(dayPayload["totalVitaminB12Ug"]),
      folate: this.numberFromPayload(dayPayload["totalFolateDfeUg"]),
    };
  }

  private numberFromPayload(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function addDaysUtcDateKey(dateKey: string, delta: number): string {
  const t = Date.parse(`${dateKey}T12:00:00.000Z`) + delta * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
