import { HttpException, HttpStatus } from "@nestjs/common";

export type AdminUserErrorCode =
  | "USER_NOT_FOUND"
  | "CANNOT_BLOCK_SELF";

const ADMIN_USER_ERROR_MESSAGES: Record<AdminUserErrorCode, string> = {
  USER_NOT_FOUND: "User not found",
  CANNOT_BLOCK_SELF: "You cannot block your own admin account",
};

export class AdminUserException extends HttpException {
  constructor(
    readonly code: AdminUserErrorCode,
    status: HttpStatus,
    message = ADMIN_USER_ERROR_MESSAGES[code],
  ) {
    super({ success: false, error: { code, message } }, status);
  }
}
