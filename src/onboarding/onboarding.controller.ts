import { Body, Controller, Get, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DashboardEventBus } from "../dashboard/dashboard-event-bus";
import { resolveClientDateKey } from "../common/date/calendar-day-bounds";
import { CompleteOnboardingDto } from "./dto/complete-onboarding.dto";
import { PreviewNutritionDto } from "./dto/preview-nutrition.dto";
import { UpdateBasicInfoDto } from "./dto/update-basic-info.dto";
import { UpdateGoalPreferencesDto } from "./dto/update-goal-preferences.dto";
import { UpdateHealthProfileDto } from "./dto/update-health-profile.dto";
import { OnboardingService } from "./onboarding.service";

type AuthenticatedRequest = Request & { user: { userId: number } };

@UseGuards(JwtAuthGuard)
@Controller("onboarding")
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly dashboardEventBus: DashboardEventBus,
  ) {}

  @Get("me")
  async me(@Req() req: AuthenticatedRequest) {
    return this.onboardingService.getSnapshot(req.user.userId);
  }

  @Patch("basic-info")
  async updateBasicInfo(@Req() req: AuthenticatedRequest, @Body() body: UpdateBasicInfoDto) {
    return this.onboardingService.updateBasicInfo(req.user.userId, body);
  }

  @Patch("health-profile")
  async updateHealthProfile(@Req() req: AuthenticatedRequest, @Body() body: UpdateHealthProfileDto) {
    const result = await this.onboardingService.updateHealthProfile(req.user.userId, body);
    const dateKey = resolveClientDateKey(undefined, 0);
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, dateKey);
    return result;
  }

  @Patch("goal-preferences")
  async updateGoalPreferences(@Req() req: AuthenticatedRequest, @Body() body: UpdateGoalPreferencesDto) {
    return this.onboardingService.updateGoalPreferences(req.user.userId, body);
  }

  @Post("complete")
  async complete(@Req() req: AuthenticatedRequest, @Body() body: CompleteOnboardingDto) {
    return this.onboardingService.complete(req.user.userId, body);
  }

  @Post("preview-nutrition")
  async previewNutrition(@Req() req: AuthenticatedRequest, @Body() body: PreviewNutritionDto) {
    return this.onboardingService.previewNutrition(req.user.userId, body);
  }
}
