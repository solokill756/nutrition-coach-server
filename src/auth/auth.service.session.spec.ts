import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "crypto";
import { AuthService } from "./auth.service";

// verifyRefreshToken falls back to this secret when JWT_REFRESH_SECRET is unset.
const REFRESH_SECRET = "dev-refresh-secret-change-me";

const buildService = () => {
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;
  const jwt = new JwtService();
  const sessionRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
  const unused = {} as never;
  const service = new AuthService(
    config, jwt, unused, unused, unused, unused, sessionRepo as never, unused, unused, unused, unused, unused,
  );
  return { service, jwt, sessionRepo };
};

const refreshTokenFor = (jwt: JwtService, sid: string) =>
  jwt.signAsync({ sub: 7, sid, type: "refresh" }, { secret: REFRESH_SECRET, expiresIn: 3600 });

describe("AuthService session endpoints", () => {
  it("logout revokes only the session the refresh token belongs to", async () => {
    const { service, jwt, sessionRepo } = buildService();
    const token = await refreshTokenFor(jwt, "session-1");

    await expect(service.logout(token)).resolves.toEqual({ success: true });

    expect(sessionRepo.update).toHaveBeenCalledWith(
      {
        id: "session-1",
        userId: 7,
        refreshTokenHash: createHash("sha256").update(token).digest("hex"),
        isRevoked: false,
      },
      { isRevoked: true, lastUsedAt: expect.any(Date) },
    );
  });

  it("logout succeeds without touching sessions when there is no token", async () => {
    const { service, sessionRepo } = buildService();
    await expect(service.logout(undefined)).resolves.toEqual({ success: true });
    expect(sessionRepo.update).not.toHaveBeenCalled();
  });

  it("logout succeeds for a token it cannot verify", async () => {
    const { service, sessionRepo } = buildService();
    await expect(service.logout("not-a-jwt")).resolves.toEqual({ success: true });
    expect(sessionRepo.update).not.toHaveBeenCalled();
  });

  it("logout succeeds when the session was already revoked (e.g. account deleted)", async () => {
    const { service, jwt, sessionRepo } = buildService();
    sessionRepo.update.mockResolvedValue({ affected: 0 });
    const token = await refreshTokenFor(jwt, "session-1");
    await expect(service.logout(token)).resolves.toEqual({ success: true });
  });

  it("refresh without a token is a 401 invalidRefreshToken, not a crash", async () => {
    const { service } = buildService();
    await expect(service.refresh({}, "1.2.3.4")).rejects.toMatchObject({
      status: 401,
      response: { errorKey: "auth.errors.invalidRefreshToken" },
    });
  });
});
