import { HttpException, HttpStatus } from "@nestjs/common";

export type AdminConditionRuleErrorCode =
  | "CONDITION_RULE_INVALID"
  | "CONDITION_RULE_NOT_FOUND"
  | "CONDITION_RULE_RISK_CONFIRMATION_REQUIRED";

const MESSAGES: Record<AdminConditionRuleErrorCode, string> = {
  CONDITION_RULE_INVALID: "Condition nutrient rule is invalid",
  CONDITION_RULE_NOT_FOUND: "Condition nutrient rule was not found",
  CONDITION_RULE_RISK_CONFIRMATION_REQUIRED: "Risky condition rule changes require confirmation",
};

export class AdminConditionRuleException extends HttpException {
  constructor(readonly code: AdminConditionRuleErrorCode, status: HttpStatus) {
    super({ success: false, code, message: MESSAGES[code] }, status);
  }
}
