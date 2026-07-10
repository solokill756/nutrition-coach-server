import { HttpException, HttpStatus } from "@nestjs/common";

export type AdminAuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "ADMIN_ONLY"
  | "ACCOUNT_BLOCKED"
  | "UNAUTHORIZED";

const ADMIN_AUTH_ERROR_MESSAGES: Record<AdminAuthErrorCode, string> = {
  INVALID_CREDENTIALS: "Email or password is incorrect",
  ADMIN_ONLY: "Admin permission required",
  ACCOUNT_BLOCKED: "Account is blocked",
  UNAUTHORIZED: "Unauthorized",
};

export class AdminAuthException extends HttpException {
  constructor(
    readonly code: AdminAuthErrorCode,
    status: HttpStatus,
    message = ADMIN_AUTH_ERROR_MESSAGES[code],
  ) {
    super({ success: false, error: { code, message } }, status);
  }
}
