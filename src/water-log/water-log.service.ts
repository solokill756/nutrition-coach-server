import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import { localDateKeyNow, resolveClientDateKey } from "../common/date/calendar-day-bounds";
import { HydrationTargetService } from "../common/hydration/hydration-target.service";
import { WaterLogEntity } from "../nutrition/entities/water-log.entity";
import { WaterTodayResponseDto } from "./dto/water-today-response.dto";
import { AddWaterResponseDto } from "./dto/add-water-response.dto";
import { WaterHistoryRowDto } from "./dto/water-history-row.dto";

@Injectable()
export class WaterLogService {
  constructor(
    @InjectRepository(WaterLogEntity)
    private readonly waterRepo: Repository<WaterLogEntity>,
    private readonly hydrationTargetService: HydrationTargetService,
  ) {}

  async getToday(userId: number, tzOffsetMinutes = 0): Promise<WaterTodayResponseDto> {
    const date = localDateKeyNow(tzOffsetMinutes);
    return this.buildDayPayload(userId, date);
  }

  async getDay(userId: number, date: string, tzOffsetMinutes = 0): Promise<WaterTodayResponseDto> {
    return this.buildDayPayload(userId, resolveClientDateKey(date, tzOffsetMinutes));
  }

  private async buildDayPayload(userId: number, date: string): Promise<WaterTodayResponseDto> {
    const row = await this.waterRepo.findOne({
      where: { userId, date, delFlag: false },
    });
    const amountMl = row?.amountMl != null ? Math.round(Number(row.amountMl)) : 0;
    const targetMl = await this.hydrationTargetService.getTargetMlForUser(userId);
    const progressPercent =
      targetMl <= 0 ? 0 : Math.round((amountMl / targetMl) * 1000) / 10;
    return {
      date,
      amountMl,
      targetMl,
      progressPercent,
    } as WaterTodayResponseDto;
  }

  async addAmount(userId: number, amountMl: number, date?: string, tzOffsetMinutes = 0): Promise<AddWaterResponseDto> {
    if (amountMl < 50 || amountMl > 3000) {
      throw new BadRequestException("amountMl must be between 50 and 3000");
    }
    const dateKey = resolveClientDateKey(date, tzOffsetMinutes);
    const row = await this.waterRepo.findOne({
      where: { userId, date: dateKey, delFlag: false },
    });
    const current = row?.amountMl != null ? Math.round(Number(row.amountMl)) : 0;
    const next = current + amountMl;

    if (row) {
      row.amountMl = String(next);
      row.updatedAt = new Date();
      await this.waterRepo.save(row);
    } else {
      await this.waterRepo.save(
        this.waterRepo.create({
          userId,
          date: dateKey,
          amountMl: String(amountMl),
          delFlag: false,
        }),
      );
    }

    return { success: true, todayTotalMl: next } as AddWaterResponseDto;
  }

  async setTodayTotal(userId: number, amountMl: number, tzOffsetMinutes = 0): Promise<AddWaterResponseDto> {
    return this.setDayTotal(userId, localDateKeyNow(tzOffsetMinutes), amountMl, tzOffsetMinutes);
  }

  async setDayTotal(userId: number, date: string, amountMl: number, tzOffsetMinutes = 0): Promise<AddWaterResponseDto> {
    if (amountMl < 0 || amountMl > 20000) {
      throw new BadRequestException("amountMl must be between 0 and 20000");
    }
    const dateKey = resolveClientDateKey(date, tzOffsetMinutes);
    const row = await this.waterRepo.findOne({
      where: { userId, date: dateKey, delFlag: false },
    });

    if (row) {
      row.amountMl = String(amountMl);
      row.updatedAt = new Date();
      await this.waterRepo.save(row);
    } else {
      await this.waterRepo.save(
        this.waterRepo.create({
          userId,
          date: dateKey,
          amountMl: String(amountMl),
          delFlag: false,
        }),
      );
    }

    return { success: true, todayTotalMl: amountMl } as AddWaterResponseDto;
  }

  async history(userId: number, from: string, to: string): Promise<WaterHistoryRowDto[]> {
    const a = from.trim().slice(0, 10);
    const b = to.trim().slice(0, 10);
    if (a > b) {
      throw new BadRequestException("`from` must be on or before `to`");
    }
    const rows = await this.waterRepo.find({
      where: {
        userId,
        delFlag: false,
        date: Between(a, b),
      },
      order: { date: "ASC" },
    });
    return rows.map((r) => ({
      date: r.date,
      amountMl: Math.round(Number(r.amountMl)),
    })) as WaterHistoryRowDto[];
  }
}
