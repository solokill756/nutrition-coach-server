import { HttpException, HttpStatus } from "@nestjs/common";

export type AdminFoodErrorCode =
  | "FOOD_NOT_FOUND"
  | "FOOD_NAME_ALREADY_EXISTS"
  | "VALIDATION_ERROR";

const ADMIN_FOOD_ERROR_MESSAGES: Record<AdminFoodErrorCode, string> = {
  FOOD_NOT_FOUND: "Food not found",
  FOOD_NAME_ALREADY_EXISTS: "Food name already exists",
  VALIDATION_ERROR: "Invalid input",
};

export class AdminFoodException extends HttpException {
  constructor(
    readonly code: AdminFoodErrorCode,
    status: HttpStatus,
    message = ADMIN_FOOD_ERROR_MESSAGES[code],
  ) {
    super({ success: false, error: { code, message } }, status);
  }
}
