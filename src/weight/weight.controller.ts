import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DashboardEventBus } from "../dashboard/dashboard-event-bus";
import { resolveClientDateKey } from "../common/date/calendar-day-bounds";
import { getRequestTzOffsetMinutes } from "../common/date/request-tz-offset";
import { WeightService } from "./weight.service";
import { CreateWeightDto } from "./dto/create-weight.dto";
import { UpdateWeightDto } from "./dto/update-weight.dto";

@Controller("api/Weight")
@UseGuards(JwtAuthGuard)
export class WeightController {
  constructor(
    private readonly weightService: WeightService,
    private readonly dashboardEventBus: DashboardEventBus,
  ) {}

  private publicBase(req: Request): string {
    const env = process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, "");
    if (env) {
      return env;
    }
    const host = req.get("host") || "localhost:3001";
    const proto = req.get("x-forwarded-proto") || req.protocol || "http";
    return `${proto}://${host}`;
  }

  @Get()
  async list(
    @Req() req: Request & { user: { userId: number } },
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("pageSize", new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ) {
    return this.weightService.list(req.user.userId, page, pageSize, startDate, endDate);
  }

  @Get(":id")
  async one(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.weightService.getOne(req.user.userId, id);
  }

  @Post()
  async create(
    @Req() req: Request & { user: { userId: number } },
    @Body(new ValidationPipe({ transform: true })) body: CreateWeightDto,
  ) {
    const result = await this.weightService.create(
      req.user.userId,
      body,
      getRequestTzOffsetMinutes(req),
    );
    const dateKey = resolveClientDateKey(undefined, getRequestTzOffsetMinutes(req));
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, dateKey);
    return result;
  }

  @Put(":id")
  async update(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
    @Body(new ValidationPipe({ transform: true })) body: UpdateWeightDto,
  ) {
    const result = await this.weightService.update(
      req.user.userId,
      id,
      body,
      getRequestTzOffsetMinutes(req),
    );
    const dateKey = resolveClientDateKey(undefined, getRequestTzOffsetMinutes(req));
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, dateKey);
    return result;
  }
}
