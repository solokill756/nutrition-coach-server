import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBody } from "@nestjs/swagger";
import { AdminAuthExceptionFilter } from "../auth/admin-auth-exception.filter";
import { AdminJwtAuthGuard } from "../auth/guards/admin-jwt-auth.guard";
import { AdminRoleGuard } from "../auth/guards/admin-role.guard";
import { AdminConditionRulesService } from "./admin-condition-rules.service";
import { WriteAdminConditionRulesRequestDto } from "./dto/admin-condition-rule-request.dto";

@Controller("admin/condition-nutrient-rules")
@UseFilters(AdminAuthExceptionFilter)
@UseGuards(AdminJwtAuthGuard, AdminRoleGuard)
export class AdminConditionRulesController {
  constructor(private readonly service: AdminConditionRulesService) {}

  @Get()
  list(@Query("conditionKey") conditionKey?: string) {
    return this.service.list(conditionKey);
  }

  @Get(":conditionKey")
  detail(@Param("conditionKey") conditionKey: string) {
    return this.service.list(conditionKey);
  }

  @Post("preview")
  preview(@Body() body: WriteAdminConditionRulesRequestDto) {
    return this.service.preview(body);
  }

  @Patch(":conditionKey")
  apply(@Param("conditionKey") conditionKey: string, @Body() body: WriteAdminConditionRulesRequestDto) {
    return this.service.apply(conditionKey, body);
  }

  @Patch(":conditionKey/:ruleId/status")
  @ApiBody({ schema: { type: "object", required: ["isActive"], properties: { isActive: { type: "boolean" } } } })
  updateStatus(
    @Param("conditionKey") conditionKey: string,
    @Param("ruleId", ParseIntPipe) ruleId: number,
    @Body() body: { isActive: boolean },
  ) {
    return this.service.updateStatus(conditionKey, ruleId, body.isActive);
  }
}
