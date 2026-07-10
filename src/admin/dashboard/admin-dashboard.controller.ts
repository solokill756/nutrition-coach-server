import { Controller, Get, UseFilters, UseGuards } from "@nestjs/common";
import { AdminAuthExceptionFilter } from "../auth/admin-auth-exception.filter";
import { AdminJwtAuthGuard } from "../auth/guards/admin-jwt-auth.guard";
import { AdminRoleGuard } from "../auth/guards/admin-role.guard";
import { AdminDashboardService } from "./admin-dashboard.service";

@Controller("admin/dashboard")
@UseFilters(AdminAuthExceptionFilter)
@UseGuards(AdminJwtAuthGuard, AdminRoleGuard)
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Get("overview")
  async overview() {
    return this.adminDashboardService.getOverview();
  }
}
