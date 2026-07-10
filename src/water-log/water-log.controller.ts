import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AddWaterDto } from "./dto/add-water.dto";
import { SetWaterTodayDto } from "./dto/set-water-today.dto";
import { WaterHistoryQueryDto } from "./dto/water-history-query.dto";
import { WaterLogService } from "./water-log.service";
import { DashboardEventBus } from "../dashboard/dashboard-event-bus";
import { resolveClientDateKey } from "../common/date/calendar-day-bounds";
import { getRequestTzOffsetMinutes } from "../common/date/request-tz-offset";

@Controller("api/water-log")
@UseGuards(JwtAuthGuard)
export class WaterLogController {
  constructor(
    private readonly waterLogService: WaterLogService,
    private readonly dashboardEventBus: DashboardEventBus,
  ) {}

  @Get("today")
  async today(@Req() req: Request & { user: { userId: number } }) {
    return this.waterLogService.getToday(req.user.userId, getRequestTzOffsetMinutes(req));
  }

  @Get("day/:date")
  async day(
    @Req() req: Request & { user: { userId: number } },
    @Param("date") date: string,
  ) {
    return this.waterLogService.getDay(req.user.userId, date, getRequestTzOffsetMinutes(req));
  }

  @Post("add")
  async add(
    @Req() req: Request & { user: { userId: number } },
    @Body() body: AddWaterDto,
  ) {
    const result = await this.waterLogService.addAmount(
      req.user.userId,
      body.amountMl,
      body.date,
      getRequestTzOffsetMinutes(req),
    );
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, body.date ?? resolveClientDateKey(undefined, 0));
    return result;
  }

  @Put("today")
  async putToday(
    @Req() req: Request & { user: { userId: number } },
    @Body() body: SetWaterTodayDto,
  ) {
    const result = await this.waterLogService.setTodayTotal(
      req.user.userId,
      body.amountMl,
      getRequestTzOffsetMinutes(req),
    );
    const dateKey = resolveClientDateKey(undefined, getRequestTzOffsetMinutes(req));
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, dateKey);
    return result;
  }

  @Put("day/:date")
  async putDay(
    @Req() req: Request & { user: { userId: number } },
    @Param("date") date: string,
    @Body() body: SetWaterTodayDto,
  ) {
    const result = await this.waterLogService.setDayTotal(
      req.user.userId,
      date,
      body.amountMl,
      getRequestTzOffsetMinutes(req),
    );
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, date);
    return result;
  }

  @Get("history")
  async history(
    @Req() req: Request & { user: { userId: number } },
    @Query() query: WaterHistoryQueryDto,
  ) {
    return this.waterLogService.history(req.user.userId, query.from, query.to);
  }
}
