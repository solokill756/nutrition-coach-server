import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between } from "typeorm";
import { localDateKeyNow } from "../common/date/calendar-day-bounds";
import { HydrationTargetService } from "../common/hydration/hydration-target.service";
import { DiaryService } from "../nutrition/diary.service";
import { DailyDiaryStatusEntity } from "../nutrition/entities/daily-diary-status.entity";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { WaterLogEntity } from "../nutrition/entities/water-log.entity";
import { DiaryDaySummary } from "../nutrition/diary.service";
import { WeightService } from "../weight/weight.service";

const DEFAULT_CAL_TARGET = 2300;

/** One row per calendar day for charts — see spec/progress_spec.md */
export interface ProgressDayRow {
  date: string;
  weightKg: number | null;
  caloriesIn: number;
  caloriesBurned: number;
  netCalories: number;
  waterMl: number;
  diaryCompleted: boolean;
  calorieTarget: number;
}

export interface ProgressTrendsSummary {
  adherenceScore: number;
  currentStreak: number;
  bestStreak: number;
}

export interface ProgressTrendsResponse {
  days: ProgressDayRow[];
  summary: ProgressTrendsSummary;
}

/**
 * MVP adherence (0–100 per day, averaged over range):
 * - 40 pts: diary marked completed
 * - 40 pts: water intake ratio vs the user's dynamic water target (linear cap at 100%)
 * - 20 pts: calorie “discipline” from remaining = target − net (net = in − burned):
 *   20 if remaining >= 0 and not “exceeded”; 10 if slightly over (−300 < remaining < 0); 0 if remaining <= −300
 */
function dayAdherencePoints(row: ProgressDayRow, waterTargetMl: number): number {
  const diaryPts = row.diaryCompleted ? 40 : 0;
  const ratio = waterTargetMl > 0 ? Math.min(1, row.waterMl / waterTargetMl) : 0;
  const waterPts = 40 * ratio;
  const remaining = row.calorieTarget - row.netCalories;
  let calPts = 0;
  if (remaining >= 0) {
    calPts = 20;
  } else if (remaining > -300) {
    calPts = 10;
  }
  return diaryPts + waterPts + calPts;
}

/** Consecutive calendar days with diaryCompleted, counting backward from anchorDate (inclusive). */
export function diaryCurrentStreak(
  completedByDate: Map<string, boolean>,
  anchorDate: string,
  minDate: string,
): number {
  let streak = 0;
  let d = anchorDate.slice(0, 10);
  const min = minDate.slice(0, 10);
  for (;;) {
    if (d < min) {
      break;
    }
    if (completedByDate.get(d)) {
      streak++;
      d = addDaysUtc(d, -1);
    } else {
      break;
    }
  }
  return streak;
}

/** Max consecutive completed days within the map’s date span. */
export function diaryBestStreak(completedByDate: Map<string, boolean>): number {
  const dates = [...completedByDate.keys()].filter((k) => completedByDate.get(k)).sort();
  if (dates.length === 0) {
    return 0;
  }
  let best = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    if (daysBetweenUtc(dates[i - 1], dates[i]) === 1) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }
  return best;
}

function addDaysUtc(dateKey: string, delta: number): string {
  const t = Date.parse(`${dateKey}T12:00:00.000Z`) + delta * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function daysBetweenUtc(a: string, b: string): number {
  const ta = Date.parse(`${a}T12:00:00.000Z`);
  const tb = Date.parse(`${b}T12:00:00.000Z`);
  return Math.round((tb - ta) / 86400000);
}

@Injectable()
export class ProgressService {
  constructor(
    private readonly diaryService: DiaryService,
    @InjectRepository(WaterLogEntity)
    private readonly waterRepo: Repository<WaterLogEntity>,
    @InjectRepository(DailyDiaryStatusEntity)
    private readonly statusRepo: Repository<DailyDiaryStatusEntity>,
    @InjectRepository(UserGoalEntity)
    private readonly goalRepo: Repository<UserGoalEntity>,
    private readonly weightService: WeightService,
    private readonly hydrationTargetService: HydrationTargetService,
  ) {}

  async getTrends(
    userId: number,
    fromKey: string,
    toKey: string,
    tzOffsetMinutes = 0,
  ): Promise<ProgressTrendsResponse> {
    const from = fromKey.trim().slice(0, 10);
    const to = toKey.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException("from and to must be YYYY-MM-DD");
    }
    if (from > to) {
      throw new BadRequestException("from must be <= to");
    }

    const rangeRows = await this.diaryService.getRange(userId, from, to, tzOffsetMinutes);
    const activeGoal = await this.goalRepo.findOne({
      where: { userId, isActive: true },
      order: { startDate: "DESC" },
    });
    const calorieTarget = Math.round(
      activeGoal?.targetCalories != null && Number.isFinite(Number(activeGoal.targetCalories))
        ? Number(activeGoal.targetCalories)
        : DEFAULT_CAL_TARGET,
    );
    const waterTargetMl = await this.hydrationTargetService.getTargetMlForUser(userId);

    const waterRows = await this.waterRepo.find({
      where: { userId, delFlag: false, date: Between(from, to) },
    });
    const waterByDay = new Map<string, number>();
    for (const w of waterRows) {
      const key = String(w.date).slice(0, 10);
      waterByDay.set(key, Math.round(Number(w.amountMl) || 0));
    }

    const statusRows = await this.statusRepo.find({
      where: { userId, date: Between(from, to) },
    });
    const completedByDay = new Map<string, boolean>();
    for (const s of statusRows) {
      const key = String(s.date).slice(0, 10);
      completedByDay.set(key, Boolean(s.isCompleted));
    }

    const weightByDay = await this.weightService.latestByDay(userId, from, to);

    const days: ProgressDayRow[] = rangeRows.map((r) => {
      const date = r.date.slice(0, 10);
      const caloriesIn = Math.round(r.totalCalories);
      const caloriesBurned = Math.round(r.exerciseCaloriesBurned);
      const netCalories = caloriesIn - caloriesBurned;
      const wKg = weightByDay.get(date);
      return {
        date,
        weightKg: wKg != null && Number.isFinite(wKg) ? wKg : null,
        caloriesIn,
        caloriesBurned,
        netCalories,
        waterMl: waterByDay.get(date) ?? 0,
        diaryCompleted: completedByDay.get(date) ?? false,
        calorieTarget,
      };
    });

    const dayScores = days.map((d) => dayAdherencePoints(d, waterTargetMl));
    const adherenceScore =
      dayScores.length === 0 ? 0 : Math.round(dayScores.reduce((a, b) => a + b, 0) / dayScores.length);

    const today = localDateKeyNow(tzOffsetMinutes);
    const anchor = today > to ? to : today < from ? to : today;
    const currentStreak = diaryCurrentStreak(completedByDay, anchor, from);
    const bestStreak = diaryBestStreak(completedByDay);

    return {
      days,
      summary: {
        adherenceScore,
        currentStreak,
        bestStreak,
      },
    };
  }
}
