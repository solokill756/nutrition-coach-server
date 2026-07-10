import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { getRequestTzOffsetMinutes } from "../common/date/request-tz-offset";
import { ProgressTrendsQueryDto } from "./dto/progress-trends-query.dto";
import { ProgressService } from "./progress.service";

@Controller("api/progress")
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get("trends")
  async trends(
    @Req() req: Request & { user: { userId: number } },
    @Query() query: ProgressTrendsQueryDto,
  ) {
    return this.progressService.getTrends(
      req.user.userId,
      query.from,
      query.to,
      getRequestTzOffsetMinutes(req),
    );
  }
}
