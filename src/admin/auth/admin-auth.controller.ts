import { Body, Controller, Get, Post, Req, UseFilters, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { AdminAuthExceptionFilter } from "./admin-auth-exception.filter";
import { AdminAuthService } from "./admin-auth.service";
import { AdminLoginRequestDto } from "./dto/admin-login-request.dto";
import { AdminJwtAuthGuard, AdminJwtUser } from "./guards/admin-jwt-auth.guard";
import { AdminRoleGuard } from "./guards/admin-role.guard";

type AdminRequest = Request & {
  user: AdminJwtUser;
};

@Controller("admin/auth")
@UseFilters(AdminAuthExceptionFilter)
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post("login")
  async login(@Body() body: AdminLoginRequestDto) {
    return this.adminAuthService.login(body);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRoleGuard)
  @Get("me")
  async me(@Req() req: AdminRequest) {
    return this.adminAuthService.me(req.user.userId);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRoleGuard)
  @Post("logout")
  async logout(@Req() req: AdminRequest) {
    return this.adminAuthService.logout(req.user.userId);
  }
}
