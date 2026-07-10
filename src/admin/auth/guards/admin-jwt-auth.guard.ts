import { ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AdminAuthException } from "../admin-auth.exception";

export type AdminJwtUser = {
  userId: number;
  email: string | null;
};

@Injectable()
export class AdminJwtAuthGuard extends AuthGuard("jwt") {
  handleRequest<TUser = AdminJwtUser>(
    err: unknown,
    user: TUser | false,
  ): TUser {
    if (err || !user) {
      throw new AdminAuthException("UNAUTHORIZED", HttpStatus.UNAUTHORIZED);
    }

    return user;
  }

  getRequest(context: ExecutionContext): unknown {
    return context.switchToHttp().getRequest();
  }
}
