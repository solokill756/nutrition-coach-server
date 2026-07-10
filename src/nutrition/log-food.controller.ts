import { Body, Controller, DefaultValuePipe, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateLogFoodDto } from "./dto/create-log-food.dto";
import { LogFoodService } from "./log-food.service";
import { getRequestTzOffsetMinutes } from "../common/date/request-tz-offset";
import { DashboardEventBus } from "../dashboard/dashboard-event-bus";
import { resolveClientDateKey } from "../common/date/calendar-day-bounds";

@Controller("api/LogFood")
@UseGuards(JwtAuthGuard)
export class LogFoodController {
  constructor(
    private readonly logFoodService: LogFoodService,
    private readonly dashboardEventBus: DashboardEventBus,
  ) {}

  @Post()
  async create(@Req() req: Request & { user: { userId: number } }, @Body() body: CreateLogFoodDto) {
    const result = await this.logFoodService.create(req.user.userId, body);
    const dateKey = resolveClientDateKey(body.LoggedAt?.slice(0, 10) ?? undefined, 0);
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, dateKey);
    return result;
  }

  @Get()
  async list(
    @Req() req: Request & { user: { userId: number } },
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("pageSize", new DefaultValuePipe(500), ParseIntPipe) pageSize: number,
    @Query("includeQuickAdd") includeQuickAdd?: string,
  ) {
    const start = startDate?.trim() || new Date().toISOString().slice(0, 10);
    const end = endDate?.trim() || start;
    const shouldIncludeQuickAdd = String(includeQuickAdd ?? "").toLowerCase() === "true";
    return this.logFoodService.list(
      req.user.userId,
      start,
      end,
      page,
      pageSize,
      shouldIncludeQuickAdd,
      getRequestTzOffsetMinutes(req),
    );
  }

  @Delete(":id")
  async remove(@Req() req: Request & { user: { userId: number } }, @Param("id") id: string) {
    const n = Number(id);
    await this.logFoodService.softDelete(req.user.userId, n);
    const dateKey = resolveClientDateKey(undefined, 0);
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, dateKey);
    return { ok: true };
  }
}
