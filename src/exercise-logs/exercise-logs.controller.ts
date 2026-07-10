import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ExerciseLogsService } from "./exercise-logs.service";
import { CreateExerciseLogDto } from "./dto/create-exercise-log.dto";
import { GetExerciseLogsQueryDto } from "./dto/get-exercise-logs-query.dto";
import { GetSummaryRangeQueryDto } from "./dto/get-summary-range-query.dto";
import { getRequestTzOffsetMinutes } from "../common/date/request-tz-offset";
import { DashboardEventBus } from "../dashboard/dashboard-event-bus";
import { resolveClientDateKey } from "../common/date/calendar-day-bounds";

@Controller("api/exercise-logs")
@UseGuards(JwtAuthGuard)
export class ExerciseLogsController {
  constructor(
    private readonly exerciseLogsService: ExerciseLogsService,
    private readonly dashboardEventBus: DashboardEventBus,
  ) {}

  @Get("summary/today")
  async summaryToday(
    @Req() req: Request & { user: { userId: number } },
    @Query("date") date?: string,
  ) {
    return this.exerciseLogsService.summaryToday(
      req.user.userId,
      date,
      getRequestTzOffsetMinutes(req),
    );
  }

  @Get("summary")
  async summaryRange(
    @Req() req: Request & { user: { userId: number } },
    @Query() query: GetSummaryRangeQueryDto,
  ) {
    return this.exerciseLogsService.summaryRange(
      req.user.userId,
      query,
      getRequestTzOffsetMinutes(req),
    );
  }

  @Get()
  async list(
    @Req() req: Request & { user: { userId: number } },
    @Query() query: GetExerciseLogsQueryDto,
  ) {
    return this.exerciseLogsService.list(req.user.userId, query, getRequestTzOffsetMinutes(req));
  }

  @Post()
  async create(
    @Req() req: Request & { user: { userId: number } },
    @Body() body: CreateExerciseLogDto,
  ) {
    const result = await this.exerciseLogsService.create(req.user.userId, body);
    const dateKey = resolveClientDateKey(undefined, 0);
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, dateKey);
    return result;
  }

  @Delete(":id")
  async remove(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
  ) {
    const result = await this.exerciseLogsService.softDelete(req.user.userId, id);
    const dateKey = resolveClientDateKey(undefined, 0);
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, dateKey);
    return result;
  }
}
