import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, In, Repository } from "typeorm";
import { AppUserEntity } from "../auth/entities/app-user.entity";
import { ExerciseEntity } from "../exercises/entities/exercise.entity";
import { WeightService } from "../weight/weight.service";
import { ExerciseLogEntity } from "./entities/exercise-log.entity";
import { CreateExerciseLogDto } from "./dto/create-exercise-log.dto";
import { GetExerciseLogsQueryDto } from "./dto/get-exercise-logs-query.dto";
import { GetSummaryRangeQueryDto } from "./dto/get-summary-range-query.dto";
import { calculateCaloriesBurned } from "./calories.util";
import {
  calendarDayBounds,
  eachCalendarDateKey,
  localDateKeyFromInstant,
  localDateKeyNow,
} from "../common/date/calendar-day-bounds";

@Injectable()
export class ExerciseLogsService {
  constructor(
    @InjectRepository(ExerciseLogEntity)
    private readonly logRepo: Repository<ExerciseLogEntity>,
    @InjectRepository(ExerciseEntity)
    private readonly exerciseRepo: Repository<ExerciseEntity>,
    @InjectRepository(AppUserEntity)
    private readonly userRepo: Repository<AppUserEntity>,
    private readonly weightService: WeightService,
  ) {}

  private dayBounds(dateKey: string, tzOffsetMinutes = 0): { start: Date; end: Date } {
    return calendarDayBounds(dateKey, tzOffsetMinutes);
  }

  async create(userId: number, dto: CreateExerciseLogDto) {
    const exercise = await this.exerciseRepo.findOne({
      where: { id: dto.exerciseId, delFlag: false },
    });
    if (!exercise || !(exercise.isVerified || (exercise.userId != null && Number(exercise.userId) === userId))) {
      throw new NotFoundException("Exercise not found");
    }

    const user = await this.userRepo.findOne({
      where: { id: userId, delFlag: false },
      select: ["id", "weight"],
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const met = exercise.met == null ? null : Number(exercise.met);
    const defaultCalPerMin =
      exercise.defaultCalPerMin == null ? null : Number(exercise.defaultCalPerMin);
    const latestWeightRows = await this.weightService.historyDescending(userId, 1);
    const latestWeightKg = latestWeightRows.length > 0 ? Number(latestWeightRows[0].weightKg) : null;
    const weightKg =
      Number.isFinite(latestWeightKg) && latestWeightKg != null && latestWeightKg > 0
        ? latestWeightKg
        : user.weight == null
          ? null
          : Number(user.weight);

    let calories: number;
    try {
      calories = calculateCaloriesBurned({
        met: Number.isFinite(met as number) && (met as number) > 0 ? met : null,
        defaultCalPerMin:
          Number.isFinite(defaultCalPerMin as number) && (defaultCalPerMin as number) > 0
            ? defaultCalPerMin
            : null,
        weightKg: Number.isFinite(weightKg as number) && (weightKg as number) > 0 ? weightKg : null,
        minutesPerformed: dto.minutesPerformed,
      });
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? "Cannot calculate calories burned");
    }

    const startedAt = dto.startedAt?.trim()
      ? new Date(dto.startedAt)
      : new Date();
    if (Number.isNaN(startedAt.getTime())) {
      throw new BadRequestException("Invalid startedAt");
    }

    const row = this.logRepo.create({
      userId,
      exerciseId: dto.exerciseId,
      startedAt,
      minutesPerformed: String(dto.minutesPerformed),
      caloriesBurned: String(calories),
      source: dto.source ?? "manual",
      capturedAt: new Date(),
      delFlag: false,
    });
    const saved = await this.logRepo.save(row);

    return this.toCreateResponse(saved, exercise);
  }

  private toCreateResponse(log: ExerciseLogEntity, exercise: ExerciseEntity) {
    const met = exercise.met == null ? null : Number(exercise.met);
    return {
      id: Number(log.id),
      userId: Number(log.userId),
      exercise: {
        id: Number(exercise.id),
        name: exercise.name,
        type: exercise.type,
        met,
      },
      startedAt: log.startedAt,
      minutesPerformed: Number(log.minutesPerformed),
      caloriesBurned: Number(log.caloriesBurned),
      source: log.source ?? "manual",
      capturedAt: log.capturedAt,
    };
  }

  private async mapLogsToListItems(logs: ExerciseLogEntity[]) {
    const exIds = [...new Set(logs.map((l) => Number(l.exerciseId)))];
    const exercises =
      exIds.length === 0
        ? []
        : await this.exerciseRepo.find({
            where: { id: In(exIds) },
          });
    const exMap = new Map(exercises.map((e) => [Number(e.id), e]));

    return logs.map((log) => {
      const ex = exMap.get(Number(log.exerciseId));
      return {
        id: Number(log.id),
        exerciseId: Number(log.exerciseId),
        exerciseName: ex?.name ?? "Unknown",
        exerciseType: ex?.type ?? null,
        startedAt: log.startedAt,
        minutesPerformed: Number(log.minutesPerformed),
        caloriesBurned: Number(log.caloriesBurned),
        source: log.source ?? "manual",
      };
    });
  }

  private resolveListRange(
    dto: GetExerciseLogsQueryDto,
    tzOffsetMinutes = 0,
  ): { start: Date; end: Date } {
    if (dto.from?.trim() && dto.to?.trim()) {
      const { start } = this.dayBounds(dto.from, tzOffsetMinutes);
      const { end } = this.dayBounds(dto.to, tzOffsetMinutes);
      if (start.getTime() > end.getTime()) {
        throw new BadRequestException("Invalid date range");
      }
      return { start, end };
    }
    const toKey = localDateKeyNow(tzOffsetMinutes);
    const { start, end } = this.dayBounds(toKey, tzOffsetMinutes);
    const fromD = new Date(start.getTime() - 30 * 86400000);
    return { start: fromD, end };
  }

  async list(userId: number, dto: GetExerciseLogsQueryDto, tzOffsetMinutes = 0) {
    const { start, end } = this.resolveListRange(dto, tzOffsetMinutes);
    const page = Math.max(1, Number(dto.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(dto.limit) || 20));

    const [logs, total] = await this.logRepo.findAndCount({
      where: {
        userId,
        delFlag: false,
        startedAt: Between(start, end),
      },
      order: { startedAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });

    const items = await this.mapLogsToListItems(logs);

    return { items, page, limit, total };
  }

  async summaryToday(userId: number, clientDate?: string, tzOffsetMinutes = 0) {
    const raw = String(clientDate ?? "").trim().slice(0, 10);
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : localDateKeyNow(tzOffsetMinutes);
    const { start, end } = this.dayBounds(dateKey, tzOffsetMinutes);
    const logs = await this.logRepo.find({
      where: { userId, delFlag: false, startedAt: Between(start, end) },
      order: { startedAt: "DESC" },
    });
    let totalCaloriesBurned = 0;
    let totalMinutes = 0;
    for (const log of logs) {
      totalCaloriesBurned += Number(log.caloriesBurned) || 0;
      totalMinutes += Number(log.minutesPerformed) || 0;
    }
    const items = await this.mapLogsToListItems(logs);
    return {
      date: dateKey,
      totalCaloriesBurned: Math.round(totalCaloriesBurned * 100) / 100,
      totalMinutes: Math.round(totalMinutes * 100) / 100,
      totalLogs: logs.length,
      items,
    };
  }

  async summaryRange(userId: number, dto: GetSummaryRangeQueryDto, tzOffsetMinutes = 0) {
    const { start } = this.dayBounds(dto.from, tzOffsetMinutes);
    const { end } = this.dayBounds(dto.to, tzOffsetMinutes);
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException("Invalid date range");
    }
    return this.aggregateRange(
      userId,
      dto.from.slice(0, 10),
      dto.to.slice(0, 10),
      start,
      end,
      tzOffsetMinutes,
    );
  }

  private async aggregateRange(
    userId: number,
    fromKey: string,
    toKey: string,
    start: Date,
    end: Date,
    tzOffsetMinutes = 0,
  ) {
    const logs = await this.logRepo.find({
      where: {
        userId,
        delFlag: false,
        startedAt: Between(start, end),
      },
      order: { startedAt: "ASC" },
    });

    let totalCaloriesBurned = 0;
    let totalMinutes = 0;
    const byDay = new Map<string, { caloriesBurned: number; minutes: number; logs: number }>();

    for (const log of logs) {
      const cal = Number(log.caloriesBurned) || 0;
      const min = Number(log.minutesPerformed) || 0;
      totalCaloriesBurned += cal;
      totalMinutes += min;
      const d = localDateKeyFromInstant(
        log.startedAt instanceof Date ? log.startedAt : new Date(log.startedAt),
        tzOffsetMinutes,
      );
      const cur = byDay.get(d) ?? { caloriesBurned: 0, minutes: 0, logs: 0 };
      cur.caloriesBurned += cal;
      cur.minutes += min;
      cur.logs += 1;
      byDay.set(d, cur);
    }

    const daily: Array<{
      date: string;
      caloriesBurned: number;
      minutes: number;
      logs: number;
    }> = [];

    for (const date of eachCalendarDateKey(fromKey, toKey)) {
      const agg = byDay.get(date);
      daily.push({
        date,
        caloriesBurned: agg?.caloriesBurned ?? 0,
        minutes: agg?.minutes ?? 0,
        logs: agg?.logs ?? 0,
      });
    }

    return {
      from: fromKey,
      to: toKey,
      totalCaloriesBurned: Math.round(totalCaloriesBurned * 100) / 100,
      totalMinutes: Math.round(totalMinutes * 100) / 100,
      totalLogs: logs.length,
      daily,
    };
  }

  async softDelete(userId: number, logId: number) {
    const row = await this.logRepo.findOne({
      where: { id: logId, userId, delFlag: false },
    });
    if (!row) {
      throw new NotFoundException("Exercise log not found");
    }
    row.delFlag = true;
    await this.logRepo.save(row);
    return { success: true };
  }
}
