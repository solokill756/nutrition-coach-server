import { Request } from "express";
import { parseTzOffsetMinutes } from "./tz-offset";

export function getRequestTzOffsetMinutes(req: Pick<Request, "headers">): number {
  return parseTzOffsetMinutes(req.headers["x-tz-offset-minutes"]);
}
