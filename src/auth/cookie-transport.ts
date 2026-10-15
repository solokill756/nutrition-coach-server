import { ForbiddenException } from "@nestjs/common";
import { CookieOptions, Request, Response } from "express";

/** Web clients send `X-Auth-Transport: cookie` to get the refresh token as an HttpOnly cookie. */
export const REFRESH_COOKIE = "cc_refresh";
const TRANSPORT_HEADER = "x-auth-transport";

const baseOptions = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  path: "/auth",
  secure,
});

export function wantsCookieTransport(req: Request): boolean {
  return String(req.headers[TRANSPORT_HEADER] ?? "").toLowerCase() === "cookie";
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Seconds until the JWT's `exp`. The server just signed it, so it is decoded without verifying. */
function secondsUntilExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return Math.max(0, Math.floor(Number(payload.exp) - Date.now() / 1000));
  } catch {
    return 0;
  }
}

export function setRefreshCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(secure),
    maxAge: secondsUntilExpiry(token) * 1000,
  });
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions(secure));
}

/** Endpoints that act on the cookie only answer the web origins we trust (CSRF guard). */
export function assertAllowedOrigin(req: Request, allowed: string[]): void {
  const origin = req.headers.origin;
  if (!origin || !allowed.includes(origin)) {
    throw new ForbiddenException({
      errorKey: "auth.errors.originNotAllowed",
      message: "Origin not allowed",
    });
  }
}
