import { ConfigService } from "@nestjs/config";
import { HttpStatus } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { Repository } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";
import { AdminAuthException } from "./admin-auth.exception";
import { AdminAuthService } from "./admin-auth.service";
import { AdminJwtAuthGuard } from "./guards/admin-jwt-auth.guard";

type MockRepository = Pick<Repository<AppUserEntity>, "findOne" | "save">;

const makeUser = (overrides: Partial<AppUserEntity> = {}): AppUserEntity => ({
  id: 1,
  email: "admin@example.com",
  passwordHash: "$2b$10$hash",
  displayName: "Admin",
  avatarUrl: null,
  status: 1,
  role: "admin",
  isProfileComplete: false,
  age: null,
  sex: null,
  weight: null,
  goalWeight: null,
  height: null,
  dietType: null,
  allergies: null,
  fitnessLevel: "beginner",
  loginAttemptCount: 0,
  lockoutUntil: null,
  lastLoginAt: null,
  passwordChangedAt: null,
  passwordResetToken: null,
  passwordResetExpires: null,
  delFlag: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

const buildService = (user: AppUserEntity | null) => {
  const repo: MockRepository = {
    findOne: jest.fn().mockResolvedValue(user),
    save: jest.fn(async (entity: AppUserEntity) => entity),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === "JWT_SECRET") return "test-secret";
      if (key === "JWT_ACCESS_EXPIRES_IN") return "15m";
      return undefined;
    }),
  } as unknown as ConfigService;

  return {
    repo,
    service: new AdminAuthService(config, new JwtService(), repo as Repository<AppUserEntity>),
  };
};

describe("AdminAuthService", () => {
  it("logs in an active admin and does not expose sensitive fields", async () => {
    const passwordHash = await bcrypt.hash("password123", 4);
    const { repo, service } = buildService(makeUser({ passwordHash }));

    const response = await service.login({
      email: "ADMIN@example.com",
      password: "password123",
    });

    expect(response.success).toBe(true);
    expect(response.data.accessToken).toEqual(expect.any(String));
    expect(response.data.admin).toEqual({
      id: 1,
      email: "admin@example.com",
      displayName: "Admin",
      avatarUrl: null,
      role: "admin",
    });
    expect(JSON.stringify(response)).not.toContain("passwordHash");
    expect(JSON.stringify(response)).not.toContain("refreshTokenHash");
    expect(JSON.stringify(response)).not.toContain("passwordResetToken");
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ lastLoginAt: expect.any(Date) }));
  });

  it("rejects wrong passwords as INVALID_CREDENTIALS", async () => {
    const passwordHash = await bcrypt.hash("password123", 4);
    const { service } = buildService(makeUser({ passwordHash }));

    await expect(service.login({ email: "admin@example.com", password: "bad" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("rejects normal users as ADMIN_ONLY", async () => {
    const passwordHash = await bcrypt.hash("password123", 4);
    const { service } = buildService(makeUser({ passwordHash, role: "user" }));

    await expect(service.login({ email: "user@example.com", password: "password123" })).rejects.toMatchObject({
      code: "ADMIN_ONLY",
    });
  });

  it("rejects blocked admins as ACCOUNT_BLOCKED", async () => {
    const passwordHash = await bcrypt.hash("password123", 4);
    const { service } = buildService(makeUser({ passwordHash, status: 0 }));

    await expect(service.login({ email: "admin@example.com", password: "password123" })).rejects.toMatchObject({
      code: "ACCOUNT_BLOCKED",
    });
  });

  it("rejects me for a non-admin token subject", async () => {
    const { service } = buildService(makeUser({ role: "user" }));

    await expect(service.me(1)).rejects.toMatchObject({
      code: "ADMIN_ONLY",
    });
  });
});

describe("AdminJwtAuthGuard", () => {
  it("rejects invalid tokens with admin auth envelope code", () => {
    const guard = new AdminJwtAuthGuard();

    expect(() => guard.handleRequest(null, false)).toThrow(AdminAuthException);
    expect(() => guard.handleRequest(null, false)).toThrow(
      expect.objectContaining({
        code: "UNAUTHORIZED",
        status: HttpStatus.UNAUTHORIZED,
      }),
    );
  });
});
