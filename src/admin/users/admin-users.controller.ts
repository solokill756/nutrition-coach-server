import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Req, UseFilters, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { AdminAuthExceptionFilter } from "../auth/admin-auth-exception.filter";
import { AdminJwtAuthGuard } from "../auth/guards/admin-jwt-auth.guard";
import { AdminRoleGuard } from "../auth/guards/admin-role.guard";
import { AdminUsersService } from "./admin-users.service";
import { AdminUserListQueryDto } from "./dto/admin-user-list-query.dto";
import { UpdateUserStatusRequestDto } from "./dto/update-user-status-request.dto";

type AdminRequest = Request & {
  user?: {
    id?: number;
    userId?: number;
    sub?: number;
  };
};

@Controller("admin/users")
@UseFilters(AdminAuthExceptionFilter)
@UseGuards(AdminJwtAuthGuard, AdminRoleGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  async list(@Query() query: AdminUserListQueryDto) {
    return this.adminUsersService.list(query);
  }

  @Get(":id")
  async detail(@Param("id", ParseIntPipe) id: number) {
    return this.adminUsersService.detail(id);
  }

  @Patch(":id/status")
  async updateStatus(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: AdminRequest,
    @Body() body: UpdateUserStatusRequestDto,
  ) {
    const adminUserId = Number(req.user?.id ?? req.user?.userId ?? req.user?.sub ?? 0);
    return this.adminUsersService.updateStatus(id, adminUserId, body);
  }
}
