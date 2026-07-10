import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DashboardService } from "./dashboard.service";
import { getRequestTzOffsetMinutes } from "../common/date/request-tz-offset";

@Controller("api/dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}
  @Get("today")
  async today(
    @Req() req: Request & { user: { userId: number } },
    @Query("date") date?: string,
  ) {
    return this.dashboardService.getTodayDashboard(
      req.user.userId,
      date,
      getRequestTzOffsetMinutes(req),
    );
  }

  @Get("today/suggestion")
  async todaySuggestion(
    @Req() req: Request & { user: { userId: number } },
    @Query("date") date?: string,
  ) {
    return this.dashboardService.getTodaySuggestion(
      req.user.userId,
      date,
      getRequestTzOffsetMinutes(req),
    );
  }
}
