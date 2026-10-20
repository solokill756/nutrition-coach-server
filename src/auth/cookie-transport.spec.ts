import { ForbiddenException } from "@nestjs/common";
import { Request, Response } from "express";
import {
  REFRESH_COOKIE,
  assertAllowedOrigin,
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
  wantsCookieTransport,
} from "./cookie-transport";

const req = (headers: Record<string, string> = {}, cookies?: Record<string, string>) =>
  ({ headers, cookies }) as unknown as Request;
const fakeRes = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });
const jwtExpiringIn = (seconds: number) => {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }),
  ).toString("base64url");
  return `header.${payload}.signature`;
};

describe("cookie transport", () => {
  it("detects the opt-in header case-insensitively", () => {
    expect(wantsCookieTransport(req({ "x-auth-transport": "cookie" }))).toBe(true);
    expect(wantsCookieTransport(req({ "x-auth-transport": "Cookie" }))).toBe(true);
    expect(wantsCookieTransport(req({ "x-auth-transport": "body" }))).toBe(false);
    expect(wantsCookieTransport(req())).toBe(false);
  });

  it("reads the refresh cookie and ignores a missing or empty one", () => {
    expect(readRefreshCookie(req({}, { [REFRESH_COOKIE]: "tok" }))).toBe("tok");
    expect(readRefreshCookie(req({}, { [REFRESH_COOKIE]: "" }))).toBeUndefined();
    expect(readRefreshCookie(req({}, {}))).toBeUndefined();
    expect(readRefreshCookie(req())).toBeUndefined();
  });

  it("sets an HttpOnly, Lax, /auth cookie that lives as long as the token", () => {
    const res = fakeRes();
    setRefreshCookie(res as unknown as Response, jwtExpiringIn(3600), true);

    const [name, , options] = res.cookie.mock.calls[0];
    expect(name).toBe("cc_refresh");
    expect(options).toEqual(
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/auth", secure: true }),
    );
    expect(options.maxAge).toBeGreaterThan(3590 * 1000);
    expect(options.maxAge).toBeLessThanOrEqual(3600 * 1000);
    expect(options).not.toHaveProperty("domain");
  });

  it("clears the cookie with the same name, path and flags", () => {
    const res = fakeRes();
    clearRefreshCookie(res as unknown as Response, false);
    expect(res.clearCookie).toHaveBeenCalledWith("cc_refresh", {
      httpOnly: true,
      sameSite: "lax",
      path: "/auth",
      secure: false,
    });
  });

  it("accepts only a listed Origin", () => {
    const allowed = ["http://localhost:5173"];
    expect(() => assertAllowedOrigin(req({ origin: "http://localhost:5173" }), allowed)).not.toThrow();
    for (const bad of [req({ origin: "https://evil.test" }), req()]) {
      expect(() => assertAllowedOrigin(bad, allowed)).toThrow(ForbiddenException);
    }
    expect(() => assertAllowedOrigin(req({ origin: "http://localhost:5173" }), [])).toThrow(
      ForbiddenException,
    );
  });

  it("reports a rejected Origin with an errorKey", () => {
    try {
      assertAllowedOrigin(req({ origin: "https://evil.test" }), []);
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toEqual({
        errorKey: "auth.errors.originNotAllowed",
        message: "Origin not allowed",
      });
    }
  });
});
