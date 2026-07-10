import { HttpException, HttpStatus } from "@nestjs/common";

export type AdminExerciseErrorCode =
  | "EXERCISE_NOT_FOUND"
  | "EXERCISE_NAME_ALREADY_EXISTS";

const ADMIN_EXERCISE_ERROR_MESSAGES: Record<AdminExerciseErrorCode, string> = {
  EXERCISE_NOT_FOUND: "Exercise not found",
  EXERCISE_NAME_ALREADY_EXISTS: "Exercise name already exists",
};

export class AdminExerciseException extends HttpException {
  constructor(
    readonly code: AdminExerciseErrorCode,
    status: HttpStatus,
    message = ADMIN_EXERCISE_ERROR_MESSAGES[code],
  ) {
    super({ success: false, error: { code, message } }, status);
  }
}
