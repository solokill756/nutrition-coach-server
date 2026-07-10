import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsBoolean, IsIn, IsOptional, Matches } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { getRequestTzOffsetMinutes } from "../common/date/request-tz-offset";
import { RecipeMealSlot } from "./dto/recipe.dto";
import { FridgeMealPlannerService } from "./fridge-meal-planner.service";

class ManualQuotaQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

class GenerateFridgePlanDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}

class RegenerateFridgeSlotDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsIn(["breakfast", "lunch", "dinner", "snack"])
  mealSlot!: RecipeMealSlot;
}

@Controller("fridge-meal-plans")
@UseGuards(JwtAuthGuard)
export class FridgeMealPlannerController {
  constructor(private readonly plannerService: FridgeMealPlannerService) {}

  @Get("manual-quota")
  async manualQuota(@Req() req: any, @Query() query: ManualQuotaQueryDto) {
    const userId = req.user?.id ?? req.user?.userId;
    return this.plannerService.getManualQuota(
      userId,
      query.date,
      getRequestTzOffsetMinutes(req),
    );
  }

  @Post("generate")
  async generate(@Req() req: any, @Body() body: GenerateFridgePlanDto) {
    const userId = req.user?.id ?? req.user?.userId;
    return this.plannerService.generateManualPlan(
      userId,
      body.date,
      { replace: body.replace === true },
      getRequestTzOffsetMinutes(req),
    );
  }

  @Post("regenerate-slot")
  async regenerateSlot(@Req() req: any, @Body() body: RegenerateFridgeSlotDto) {
    const userId = req.user?.id ?? req.user?.userId;
    return this.plannerService.regenerateSlot(
      userId,
      body.date,
      body.mealSlot,
      getRequestTzOffsetMinutes(req),
    );
  }
}
