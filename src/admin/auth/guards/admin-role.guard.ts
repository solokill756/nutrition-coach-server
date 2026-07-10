import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { AdminAuthService } from "../admin-auth.service";
import { AdminAuthException } from "../admin-auth.exception";
import { AdminJwtUser } from "./admin-jwt-auth.guard";

type RequestWithAdminJwtUser = {
  user?: AdminJwtUser;
};

@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAdminJwtUser>();
    const userId = request.user?.userId;

    if (!userId) {
      throw new AdminAuthException("UNAUTHORIZED", HttpStatus.UNAUTHORIZED);
    }

    await this.adminAuthService.assertActiveAdmin(userId);
    return true;
  }
}
