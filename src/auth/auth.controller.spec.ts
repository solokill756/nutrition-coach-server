import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

const ORIGIN = "http://localhost:5173";
const issued = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresIn: 900,
  isNewUser: false,
  user: { id: 7 },
};

const buildController = (
  env: Record<string, string | undefined> = { CORS_ORIGINS: ORIGIN, AUTH_COOKIE_SECURE: "true" },
) => {
  const authService = {
    login: jest.fn().mockResolvedValue(issued),
    register: jest.fn().mockResolvedValue(issued),
    oauthGoogle: jest.fn().mockResolvedValue(issued),
    oauthApple: jest.fn().mockResolvedValue(issued),
    refresh: jest.fn().mockResolvedValue(issued),
    logout: jest.fn().mockResolvedValue({ success: true }),
    logoutAll: jest.fn().mockResolvedValue({ success: true }),
  };
  const config = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
  return {
    controller: new AuthController(authService as unknown as AuthService, config),
    authService,
  };
};

const cookieReq = (opts: { cookie?: string; origin?: string | null } = {}) =>
  ({
    headers: {
      "x-auth-transport": "cookie",
      ...(opts.origin === null ? {} : { origin: opts.origin ?? ORIGIN }),
    },
    cookies: opts.cookie ? { cc_refresh: opts.cookie } : {},
    ip: "1.2.3.4",
  }) as unknown as Request;
const bodyReq = () => ({ headers: {}, cookies: {}, ip: "1.2.3.4" }) as unknown as Request;
const fakeRes = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });
const asRes = (res: ReturnType<typeof fakeRes>) => res as unknown as Response;

describe("AuthController cookie transport", () => {
  it.each(["login", "register", "oauthGoogle"] as const)(
    "%s in cookie mode sets the refresh cookie and keeps it out of the body",
    async (method) => {
      const { controller } = buildController();
      const res = fakeRes();

      const body = await (controller[method] as (...args: unknown[]) => Promise<object>)(
        {}, cookieReq(), asRes(res),
      );

      expect(res.cookie).toHaveBeenCalledWith(
        "cc_refresh",
        "refresh-1",
        expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/auth", secure: true }),
      );
      expect(body).not.toHaveProperty("refreshToken");
      expect(body).toHaveProperty("accessToken", "access-1");
    },
  );

  it("login without the header still returns both tokens in the body (mobile)", async () => {
    const { controller } = buildController();
    const res = fakeRes();
    const body = await controller.login({} as never, bodyReq(), asRes(res));
    expect(body).toEqual(issued);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("refresh in cookie mode reads the cookie and rotates it", async () => {
    const { controller, authService } = buildController();
    const res = fakeRes();

    const body = await controller.refresh({}, cookieReq({ cookie: "old-refresh" }), asRes(res));

    expect(authService.refresh).toHaveBeenCalledWith(
      { refreshToken: "old-refresh", deviceInfo: undefined },
      "1.2.3.4",
    );
    expect(res.cookie).toHaveBeenCalledWith("cc_refresh", "refresh-1", expect.any(Object));
    expect(body).not.toHaveProperty("refreshToken");
  });

  it("refresh in cookie mode ignores a token sent in the body", async () => {
    const { controller, authService } = buildController();
    await controller.refresh(
      { refreshToken: "body-token-that-must-be-ignored" },
      cookieReq({ cookie: "cookie-token" }),
      asRes(fakeRes()),
    );
    expect(authService.refresh.mock.calls[0][0].refreshToken).toBe("cookie-token");
  });

  it.each([
    ["an unknown origin", cookieReq({ origin: "https://evil.test" })],
    ["no origin", cookieReq({ origin: null })],
  ])("refresh in cookie mode rejects %s with 403", async (_label, req) => {
    const { controller, authService } = buildController();
    await expect(controller.refresh({}, req, asRes(fakeRes()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(authService.refresh).not.toHaveBeenCalled();
  });

  it("refresh in cookie mode is a clear 403 when CORS_ORIGINS is not configured", async () => {
    const { controller } = buildController({ CORS_ORIGINS: undefined });
    await expect(
      controller.refresh({}, cookieReq({ cookie: "old" }), asRes(fakeRes())),
    ).rejects.toMatchObject({ response: { errorKey: "auth.errors.originNotAllowed" } });
  });

  it("refresh without the header uses the body token and sets no cookie", async () => {
    const { controller, authService } = buildController();
    const res = fakeRes();
    const body = await controller.refresh(
      { refreshToken: "body-token", deviceInfo: "mobile" },
      bodyReq(),
      asRes(res),
    );
    expect(authService.refresh).toHaveBeenCalledWith(
      { refreshToken: "body-token", deviceInfo: "mobile" },
      "1.2.3.4",
    );
    expect(body).toEqual(issued);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("logout in cookie mode revokes the cookie's session and clears the cookie", async () => {
    const { controller, authService } = buildController();
    const res = fakeRes();
    await expect(
      controller.logout({}, cookieReq({ cookie: "old-refresh" }), asRes(res)),
    ).resolves.toEqual({ success: true });
    expect(authService.logout).toHaveBeenCalledWith("old-refresh");
    expect(res.clearCookie).toHaveBeenCalledWith("cc_refresh", expect.objectContaining({ path: "/auth" }));
  });

  it("logout without the header revokes the body token's session", async () => {
    const { controller, authService } = buildController();
    const res = fakeRes();
    await controller.logout({ refreshToken: "mobile-token" }, bodyReq(), asRes(res));
    expect(authService.logout).toHaveBeenCalledWith("mobile-token");
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it("logout-all in cookie mode also clears the cookie", async () => {
    const { controller, authService } = buildController();
    const res = fakeRes();
    const req = Object.assign(cookieReq({ cookie: "x" }), { user: { userId: 7 } });
    await controller.logoutAll(req, asRes(res));
    expect(authService.logoutAll).toHaveBeenCalledWith(7);
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it("drops the Secure flag when AUTH_COOKIE_SECURE=false", async () => {
    const { controller } = buildController({ CORS_ORIGINS: ORIGIN, AUTH_COOKIE_SECURE: "false" });
    const res = fakeRes();
    await controller.login({} as never, cookieReq(), asRes(res));
    expect(res.cookie.mock.calls[0][2]).toEqual(expect.objectContaining({ secure: false }));
  });
});
