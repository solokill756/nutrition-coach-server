import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { Request } from "express";
import { AuthService } from "../auth/auth.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DashboardEventBus } from "../dashboard/dashboard-event-bus";
import { resolveClientDateKey } from "../common/date/calendar-day-bounds";
import { UpdateUserHealthProfileDto } from "./dto/update-health-profile.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UpdateUserGoalDto } from "./dto/update-user-goal.dto";
import { UserHealthProfileService } from "./user-health-profile.service";

@Controller("users")
export class UsersController {
  constructor(
    private readonly authService: AuthService,
    private readonly dashboardEventBus: DashboardEventBus,
    private readonly healthProfile: UserHealthProfileService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Delete("me")
  async deleteMe(@Req() req: Request & { user: { userId: number } }) {
    return this.authService.deleteOwnAccount(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch("health-profile")
  async patchHealthProfile(
    @Req() req: Request & { user: { userId: number } },
    @Body() dto: UpdateUserHealthProfileDto,
  ) {
    const { userId } = req.user;
    await this.healthProfile.update(userId, dto);
    this.dashboardEventBus.emitDiaryChanged(userId, resolveClientDateKey(undefined, 0), { allDates: true });
    return this.authService.me(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch("profile")
  async patchProfile(
    @Req() req: Request & { user: { userId: number } },
    @Body() dto: UpdateProfileDto
  ) {
    const result = await this.authService.patchProfile(req.user.userId, dto);
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, resolveClientDateKey(undefined, 0));
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Patch("goal")
  async patchGoal(@Req() req: Request & { user: { userId: number } }, @Body() dto: UpdateUserGoalDto) {
    const result = await this.authService.patchUserGoal(req.user.userId, dto);
    const dateKey = resolveClientDateKey(undefined, 0);
    this.dashboardEventBus.emitDiaryChanged(req.user.userId, dateKey);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Post("avatar")
  async uploadAvatar() {
    throw new BadRequestException({
      errorKey: "common.errors.badRequest",
      message: "Deprecated endpoint. Upload image to Firebase Storage from client, then send avatarUrl via PATCH /users/profile."
    });
  }
}
