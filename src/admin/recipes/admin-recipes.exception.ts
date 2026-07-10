import { HttpException, HttpStatus } from "@nestjs/common";

export type AdminRecipeErrorCode =
  | "RECIPE_NOT_FOUND"
  | "RECIPE_TITLE_ALREADY_EXISTS"
  | "INGREDIENT_FOOD_NOT_FOUND";

const ADMIN_RECIPE_ERROR_MESSAGES: Record<AdminRecipeErrorCode, string> = {
  RECIPE_NOT_FOUND: "Recipe not found",
  RECIPE_TITLE_ALREADY_EXISTS: "Recipe title already exists for this user",
  INGREDIENT_FOOD_NOT_FOUND: "One or more ingredient foods were not found",
};

export class AdminRecipeException extends HttpException {
  constructor(
    readonly code: AdminRecipeErrorCode,
    status: HttpStatus,
    message = ADMIN_RECIPE_ERROR_MESSAGES[code],
  ) {
    super({ success: false, error: { code, message } }, status);
  }
}
