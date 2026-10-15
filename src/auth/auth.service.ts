import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import * as bcrypt from "bcrypt";
import { createHash, randomBytes, randomUUID } from "crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { Auth, DecodedIdToken, getAuth } from "firebase-admin/auth";
import { MoreThan, QueryFailedError, Raw, Repository } from "typeorm";
import {
  AuthNutritionalThreshold,
  AuthTokens,
  AuthUser,
  ExternalIdentity,
  ExternalProvider,
  JwtRefreshPayload,
} from "./auth.types";
import { UserGoalEntity } from "../nutrition/entities/user-goal.entity";
import { UserHealthConditionEntity } from "../nutrition/entities/user-health-condition.entity";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";
import { percentMealSplits, validateMealSplits } from "../nutrition/meal-splits";
import { NutritionCalculatorService } from "../nutrition/nutrition-calculator.service";
import { UserContextService } from "../nutrition/user-context.service";
import { UserThresholdBuilderService } from "../nutrition/user-threshold-builder.service";
import { UserThresholdPersistenceService } from "../nutrition/user-threshold-persistence.service";
import { AppUserEntity } from "./entities/app-user.entity";
import { UserSessionEntity } from "./entities/user-session.entity";
import { UserExternalAccountEntity } from "./entities/user-external-account.entity";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { OauthDto } from "./dto/oauth.dto";
import { UpdateProfileDto } from "../users/dto/update-profile.dto";
import { UpdateUserGoalDto } from "../users/dto/update-user-goal.dto";
import { WeightService } from "../weight/weight.service";

type AuthResponse = AuthTokens & { user: AuthUser; isNewUser: boolean };

type ExternalPayload = {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
};

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "auth.errors.emailAlreadyRegistered": "Email already registered",
  "auth.errors.invalidCredentials": "Invalid credentials",
  "auth.errors.accountTemporarilyLocked": "Account is temporarily locked",
  "auth.errors.userNotFound": "User not found",
  "auth.errors.invalidRefreshSession": "Invalid refresh session",
  "auth.errors.invalidOrExpiredResetToken": "Invalid or expired reset token",
  "auth.errors.unableToIssueRefreshToken": "Unable to issue refresh token",
  "auth.errors.invalidRefreshTokenPayload": "Invalid refresh token payload",
  "auth.errors.invalidRefreshToken": "Invalid refresh token",
  "auth.errors.googleOauthNotConfigured": "Google OAuth is not configured",
  "auth.errors.appleOauthNotConfigured": "Apple OAuth is not configured",
  "auth.errors.firebaseOauthNotConfigured": "Firebase OAuth is not configured",
  "auth.errors.invalidProviderIdToken": "Invalid provider ID token",
  "auth.errors.googleTokenProviderMismatch": "Token provider is not Google",
  "auth.errors.appleTokenProviderMismatch": "Token provider is not Apple",
  "auth.errors.providerTokenMissingSubject": "Provider token missing subject",
  "auth.errors.invalidAccessToken": "Invalid access token",
  "auth.errors.weakPassword": "Password must be at least 8 characters",
  "auth.errors.profileIncomplete":
    "Complete your profile before changing goals",
  "validation.isDateString": "Value must be a valid ISO 8601 date string",
  "users.errors.invalidMealSplits": "Meal split must add up to 100%.",
};

/**
 * Turns FIREBASE_PRIVATE_KEY from the environment into a PEM string.
 * dotenv strips surrounding quotes but `docker run --env-file` keeps them,
 * and both leave line breaks escaped as `\n`.
 */
function normalizeFirebasePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  const unquoted = /^(["'])([\s\S]*)\1$/.exec(trimmed)?.[2] ?? trimmed;
  return unquoted.replace(/\\n/g, "\n").trim();
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private firebaseAuthClient: Auth | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly nutritionCalculator: NutritionCalculatorService,
    private readonly thresholdBuilder: UserThresholdBuilderService,
    private readonly thresholdPersistence: UserThresholdPersistenceService,
    @InjectRepository(AppUserEntity)
    private readonly appUserRepo: Repository<AppUserEntity>,
    @InjectRepository(UserSessionEntity)
    private readonly sessionRepo: Repository<UserSessionEntity>,
    @InjectRepository(UserExternalAccountEntity)
    private readonly externalRepo: Repository<UserExternalAccountEntity>,
    @InjectRepository(UserGoalEntity)
    private readonly goalRepo: Repository<UserGoalEntity>,
    @InjectRepository(UserHealthConditionEntity)
    private readonly healthRepo: Repository<UserHealthConditionEntity>,
    @InjectRepository(UserNutritionalThresholdEntity)
    private readonly thresholdRepo: Repository<UserNutritionalThresholdEntity>,
    private readonly weightService: WeightService,
    private readonly userContextService: UserContextService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const email = this.normalizeEmail(dto.email);
    const existing = await this.findUserByEmail(email);
    if (existing) {
      throw this.conflict("auth.errors.emailAlreadyRegistered");
    }

    const passwordHash = await this.hashPassword(dto.password);
    const displayName =
      dto.displayName?.trim() || this.buildDisplayNameFromEmail(email);

    const created = await this.appUserRepo.save(
      this.appUserRepo.create({
        email,
        passwordHash,
        displayName,
        status: 1,
        isProfileComplete: false,
        delFlag: false,
        loginAttemptCount: 0,
      }),
    );

    const user = this.toAuthUser(created);
    return this.issueTokensForUser(user, undefined);
  }

  async login(dto: LoginDto, ipAddress?: string): Promise<AuthResponse> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.findUserByEmail(email);

    if (!user || !user.passwordHash) {
      throw this.unauthorized("auth.errors.invalidCredentials");
    }

    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      throw this.unauthorized("auth.errors.accountTemporarilyLocked");
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      await this.increaseLoginAttempts(user);
      throw this.unauthorized("auth.errors.invalidCredentials");
    }

    user.loginAttemptCount = 0;
    user.lockoutUntil = null;
    user.lastLoginAt = new Date();
    await this.appUserRepo.save(user);

    return this.issueTokensForUser(this.toAuthUser(user), {
      deviceInfo: dto.deviceInfo,
      ipAddress,
    });
  }

  async me(userId: number): Promise<AuthUser> {
    const user = await this.appUserRepo.findOne({
      where: { id: userId, delFlag: false },
    });

    if (!user) {
      throw this.unauthorized("auth.errors.userNotFound");
    }

    const currentWeightKg = await this.resolveCurrentWeightKg(user);
    const base = {
      ...this.toAuthUser(user),
      currentWeightKg,
      startWeightKg: user.startWeight != null && user.startWeight > 0 ? Number(user.startWeight) : null,
    };
    const healthConditions = await this.healthRepo.find({
      where: { userId: user.id, isActive: true },
    });
    const healthMeta = this.mapHealthConditions(healthConditions);

    let goal = await this.goalRepo.findOne({
      where: { userId: user.id, isActive: true },
    });

    const goalMeta =
      goal != null
        ? {
            goalType: goal.goalType,
          }
        : {};

    if (!user.isProfileComplete) {
      return {
        ...base,
        ...goalMeta,
        ...healthMeta,
        nutritionTargets: null,
        nutritionalThresholds: [],
      };
    }

    if (!goal?.targetCalories || goal.targetCalories <= 0) {
      return {
        ...base,
        ...goalMeta,
        ...healthMeta,
        nutritionTargets: null,
        nutritionalThresholds: [],
      };
    }

    const thresholds = await this.thresholdRepo.find({
      where: { userId: user.id, isActive: true },
    });
    const plan = this.nutritionCalculator.computeNutritionPlan({
      gender: user.sex,
      age: user.age,
      heightCm: user.height,
      currentWeightKg,
      activityLevel: user.fitnessLevel,
      goalType: goal.goalType,
    });
    const fromThr = this.nutritionCalculator.macroBreakdownFromThresholds(
      goal.targetCalories,
      thresholds,
    );
    const macros =
      fromThr ??
      this.nutritionCalculator.macroBreakdownFromTargetCalories(
        goal.targetCalories,
      );

    return {
      ...base,
      ...goalMeta,
      ...healthMeta,
      nutritionTargets: {
        targetCalories: goal.targetCalories,
        bmr: plan.bmr,
        tdee: plan.tdee,
        ...macros,
      },
      nutritionalThresholds: this.mapNutritionalThresholds(thresholds),
    };
  }

  private mapHealthConditions(
    rows: UserHealthConditionEntity[],
  ): Pick<AuthUser, "conditionTypes"> {
    return {
      conditionTypes: rows.map((item) => item.conditionName),
    };
  }

  private mapNutritionalThresholds(
    rows: UserNutritionalThresholdEntity[],
  ): AuthNutritionalThreshold[] {
    return rows.map((t) => ({
      nutrient: t.nutrient,
      minAmount: t.minAmount == null ? null : Number(t.minAmount),
      maxAmount: t.maxAmount == null ? null : Number(t.maxAmount),
      unit: t.unit ?? "g",
    }));
  }

  private async resolveCurrentWeightKg(
    user: AppUserEntity,
  ): Promise<number | null> {
    const latestRows = await this.weightService.historyDescending(
      Number(user.id),
      1,
    );
    const latestWeight =
      latestRows.length > 0 ? Number(latestRows[0].weightKg) : NaN;
    if (Number.isFinite(latestWeight) && latestWeight > 0) {
      return latestWeight;
    }
    return user.weight;
  }

  async patchUserGoal(
    userId: number,
    dto: UpdateUserGoalDto,
  ): Promise<AuthUser> {
    const user = await this.appUserRepo.findOne({
      where: { id: userId, delFlag: false },
    });
    if (!user) {
      throw this.unauthorized("auth.errors.userNotFound");
    }
    if (!user.isProfileComplete) {
      throw this.unprocessable("auth.errors.profileIncomplete");
    }

    const slug = this.nutritionCalculator.normalizeGoalType(dto.goalType);

    const conditionTypes = await this.loadActiveConditionTypes(userId);
    const currentWeightKg = await this.resolveCurrentWeightKg(user);
    const plan = this.nutritionCalculator.computeNutritionPlan({
      gender: user.sex,
      age: user.age,
      heightCm: user.height,
      currentWeightKg,
      activityLevel: user.fitnessLevel,
      goalType: slug,
    });
    // A user-chosen target keeps the plan's macro percentages; grams scale with it.
    const adjustedCalories = dto.targetCalories ?? plan.targetCalories;
    const gramScale =
      plan.targetCalories > 0 ? adjustedCalories / plan.targetCalories : 1;
    const scaleG = (g: number) => Math.round(g * gramScale * 10) / 10;

    await this.goalRepo.manager.transaction(async (manager) => {
      await manager.update(
        UserGoalEntity,
        { userId, isActive: true },
        { isActive: false, updatedAt: new Date() },
      );

      const { thresholds: thresholdRows } = await this.thresholdBuilder.build({
        userId,
        targetCalories: adjustedCalories,
        macroCenter: {
          proteinG: scaleG(plan.proteinG),
          carbsG: scaleG(plan.carbsG),
          fatG: scaleG(plan.fatG),
          proteinPercent: plan.proteinPercent,
          carbsPercent: plan.carbsPercent,
          fatPercent: plan.fatPercent,
        },
        conditionTypes,
        gender: user.sex ?? null,
        allowAutoRebalance: true,
        bodyWeightKg: currentWeightKg ?? undefined,
      });
      await this.thresholdPersistence.replaceUserThresholds(manager, userId, thresholdRows);

      await manager.save(
        manager.create(UserGoalEntity, {
          userId,
          goalType: slug,
          targetCalories: adjustedCalories,
          startDate: new Date(),
          endDate: null,
          isActive: true,
        }),
      );
    });

    return this.me(userId);
  }

  private async loadActiveConditionTypes(userId: number): Promise<string[]> {
    const rows = await this.healthRepo.find({
      where: { userId, isActive: true },
    });
    return rows.map((r) => r.conditionName);
  }

  async patchProfile(userId: number, dto: UpdateProfileDto): Promise<AuthUser> {
    const user = await this.appUserRepo.findOne({
      where: { id: userId, delFlag: false },
    });

    if (!user) {
      throw this.unauthorized("auth.errors.userNotFound");
    }

    let changed = false;

    if (dto.displayName !== undefined) {
      const name = dto.displayName.trim();
      if (name.length >= 2 && name !== user.displayName) {
        user.displayName = name;
        changed = true;
      }
    }

    if (dto.email !== undefined && dto.email.trim().length > 0) {
      const email = this.normalizeEmail(dto.email);
      const current = user.email ? this.normalizeEmail(user.email) : "";
      if (email !== current) {
        const existing = await this.findUserByEmail(email);
        if (existing && Number(existing.id) !== Number(user.id)) {
          throw this.conflict("auth.errors.emailAlreadyRegistered");
        }
        user.email = email;
        changed = true;
      }
    }

    if (dto.newPassword !== undefined && dto.newPassword.length > 0) {
      if (dto.newPassword.length < 8) {
        throw this.unprocessable("auth.errors.weakPassword");
      }
      user.passwordHash = await this.hashPassword(dto.newPassword);
      user.passwordChangedAt = new Date();
      changed = true;
    }

    if (dto.avatarUrl !== undefined) {
      const raw = dto.avatarUrl.trim();
      user.avatarUrl = raw.length > 0 ? raw : null;
      changed = true;
    }

    let mealSplitsChanged = false;
    if (dto.mealSplits !== undefined) {
      if (dto.mealSplits === null) {
        user.mealSplits = null;
      } else {
        const splits = validateMealSplits(dto.mealSplits);
        if (!splits) throw this.unprocessable("users.errors.invalidMealSplits");
        user.mealSplits = splits;
      }
      changed = true;
      mealSplitsChanged = true;
    }

    if (changed) {
      user.updatedAt = new Date();
      await this.appUserRepo.save(user);
    }
    // Recipe context caches the split for 5 minutes; the next recipe must use the new one.
    if (mealSplitsChanged) this.userContextService.invalidateUserCache(userId);

    return this.me(userId);
  }

  async refresh(dto: RefreshDto, ipAddress?: string): Promise<AuthResponse> {
    const payload = await this.verifyRefreshToken(dto.refreshToken);
    const refreshHash = this.hashToken(dto.refreshToken);

    const session = await this.sessionRepo.findOne({
      where: {
        id: payload.sid,
        userId: payload.sub,
        refreshTokenHash: refreshHash,
        isRevoked: false,
        refreshTokenExpires: MoreThan(new Date()),
      },
    });

    if (!session) {
      throw this.unauthorized("auth.errors.invalidRefreshSession");
    }

    session.isRevoked = true;
    session.lastUsedAt = new Date();
    await this.sessionRepo.save(session);

    const user = await this.appUserRepo.findOne({
      where: { id: payload.sub, delFlag: false },
    });
    if (!user) {
      throw this.unauthorized("auth.errors.userNotFound");
    }

    return this.issueTokensForUser(this.toAuthUser(user), {
      deviceInfo: dto.deviceInfo,
      ipAddress,
    });
  }

  async logoutAll(userId: number): Promise<{ success: boolean }> {
    await this.sessionRepo
      .createQueryBuilder()
      .update(UserSessionEntity)
      .set({ isRevoked: true, lastUsedAt: new Date() })
      .where('"UserId" = :userId AND "IsRevoked" = false', { userId })
      .execute();

    return { success: true };
  }

  /**
   * Soft-delete the authenticated user: revoke sessions, deactivate goals/thresholds, mark DelFlag.
   * Email/password cleared so the same email can register again (findUserByEmail ignores delFlag rows).
   */
  async deleteOwnAccount(userId: number): Promise<{ success: boolean }> {
    const user = await this.appUserRepo.findOne({
      where: { id: userId, delFlag: false },
    });

    if (!user) {
      throw this.unauthorized("auth.errors.userNotFound");
    }

    await this.logoutAll(userId);

    await this.goalRepo.update(
      { userId, isActive: true },
      { isActive: false, updatedAt: new Date() },
    );
    await this.thresholdRepo.update(
      { userId, isActive: true },
      { isActive: false, updatedAt: new Date() },
    );

    user.delFlag = true;
    user.status = 0;
    user.email = null;
    user.passwordHash = null;
    user.isProfileComplete = false;
    user.displayName = "Deleted user";
    user.avatarUrl = null;
    user.updatedAt = new Date();
    await this.appUserRepo.save(user);

    return { success: true };
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<{ success: boolean; resetToken?: string }> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.findUserByEmail(email);

    if (!user) {
      return { success: true };
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);
    const ttlMinutes = Number(
      this.config.get<string>("AUTH_RESET_TOKEN_MINUTES") || 60,
    );
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    user.passwordResetToken = tokenHash;
    user.passwordResetExpires = expiresAt;
    await this.appUserRepo.save(user);

    if (
      (this.config.get<string>("NODE_ENV") || "development") !== "production"
    ) {
      return { success: true, resetToken: rawToken };
    }

    return { success: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: boolean }> {
    const tokenHash = this.hashToken(dto.token);

    const user = await this.appUserRepo.findOne({
      where: {
        passwordResetToken: tokenHash,
        passwordResetExpires: MoreThan(new Date()),
        delFlag: false,
      },
    });

    if (!user) {
      throw this.badRequest("auth.errors.invalidOrExpiredResetToken");
    }

    user.passwordHash = await this.hashPassword(dto.newPassword);
    user.passwordChangedAt = new Date();
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await this.appUserRepo.save(user);

    await this.logoutAll(user.id);
    return { success: true };
  }

  async oauthGoogle(dto: OauthDto, ipAddress?: string): Promise<AuthResponse> {
    const identity = await this.verifyGoogleToken(dto.idToken);
    return this.loginWithExternalIdentity(identity, dto.deviceInfo, ipAddress);
  }

  async oauthApple(dto: OauthDto, ipAddress?: string): Promise<AuthResponse> {
    const identity = await this.verifyAppleToken(dto.idToken);
    return this.loginWithExternalIdentity(identity, dto.deviceInfo, ipAddress);
  }

  private async loginWithExternalIdentity(
    identity: ExternalIdentity,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<AuthResponse> {
    let isNewUser = false;
    let user = await this.findUserByExternal(
      identity.provider,
      identity.subject,
    );

    if (!user && identity.email) {
      user = await this.findUserByEmail(identity.email);
    }

    if (!user) {
      isNewUser = true;
      if (identity.email) {
        await this.releaseDeletedEmail(identity.email);
      }
      try {
        user = await this.appUserRepo.save(
          this.appUserRepo.create({
            email: identity.email,
            passwordHash: null,
            displayName:
              identity.displayName ||
              this.buildDisplayNameFromProvider(identity.provider),
            avatarUrl: identity.avatarUrl,
            status: 1,
            isProfileComplete: false,
            delFlag: false,
            loginAttemptCount: 0,
          }),
        );
      } catch (error) {
        if (
          this.isUniqueConstraintError(error, "UX_AppUser_Email_lower") &&
          identity.email
        ) {
          const existing = await this.findUserByEmail(identity.email);
          if (existing) {
            user = existing;
            isNewUser = false;
          } else {
            await this.releaseDeletedEmail(identity.email);
            user = await this.appUserRepo.save(
              this.appUserRepo.create({
                email: identity.email,
                passwordHash: null,
                displayName:
                  identity.displayName ||
                  this.buildDisplayNameFromProvider(identity.provider),
                avatarUrl: identity.avatarUrl,
                status: 1,
                isProfileComplete: false,
                delFlag: false,
                loginAttemptCount: 0,
              }),
            );
          }
        } else {
          throw error;
        }
      }
    }

    await this.upsertExternalAccount(user.id, identity);

    return this.issueTokensForUser(this.toAuthUser(user), {
      deviceInfo,
      ipAddress,
      isNewUser,
    });
  }

  private async issueTokensForUser(
    user: AuthUser,
    metadata?: { deviceInfo?: string; ipAddress?: string; isNewUser?: boolean },
  ): Promise<AuthResponse> {
    const accessSecret =
      this.config.get<string>("JWT_SECRET") || "dev-access-secret-change-me";
    const refreshSecret =
      this.config.get<string>("JWT_REFRESH_SECRET") ||
      "dev-refresh-secret-change-me";
    const accessExpiresInRaw =
      this.config.get<string>("JWT_ACCESS_EXPIRES_IN") || "15m";
    const refreshExpiresInRaw =
      this.config.get<string>("JWT_REFRESH_EXPIRES_IN") || "7d";
    const accessExpiresInSeconds =
      this.parseDurationSeconds(accessExpiresInRaw);
    const refreshExpiresInSeconds =
      this.parseDurationSeconds(refreshExpiresInRaw);

    const sessionId = randomUUID();

    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, type: "access" },
      { secret: accessSecret, expiresIn: accessExpiresInSeconds },
    );

    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, sid: sessionId, type: "refresh" },
      { secret: refreshSecret, expiresIn: refreshExpiresInSeconds },
    );

    const decoded = this.jwtService.decode(refreshToken) as {
      exp?: number;
    } | null;
    if (!decoded || !decoded.exp) {
      throw this.unauthorized("auth.errors.unableToIssueRefreshToken");
    }

    await this.sessionRepo.save(
      this.sessionRepo.create({
        id: sessionId,
        userId: user.id,
        refreshTokenHash: this.hashToken(refreshToken),
        refreshTokenExpires: new Date(decoded.exp * 1000),
        deviceInfo: metadata?.deviceInfo || null,
        ipAddress: metadata?.ipAddress || null,
        isRevoked: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      }),
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiresInSeconds,
      user,
      isNewUser: metadata?.isNewUser ?? false,
    };
  }

  private async verifyRefreshToken(token: string): Promise<JwtRefreshPayload> {
    try {
      const refreshSecret =
        this.config.get<string>("JWT_REFRESH_SECRET") ||
        "dev-refresh-secret-change-me";
      const payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(
        token,
        {
          secret: refreshSecret,
        },
      );

      if (payload.type !== "refresh" || typeof payload.sid !== "string") {
        throw this.unauthorized("auth.errors.invalidRefreshTokenPayload");
      }

      return payload;
    } catch {
      throw this.unauthorized("auth.errors.invalidRefreshToken");
    }
  }

  private async verifyGoogleToken(idToken: string): Promise<ExternalIdentity> {
    const decoded = await this.verifyFirebaseIdToken(idToken);
    this.assertFirebaseProvider(
      decoded,
      "google.com",
      "auth.errors.googleTokenProviderMismatch",
    );
    return this.buildExternalIdentity(
      "google",
      this.mapFirebaseTokenToExternalPayload(decoded),
    );
  }

  private async verifyAppleToken(idToken: string): Promise<ExternalIdentity> {
    const decoded = await this.verifyFirebaseIdToken(idToken);
    this.assertFirebaseProvider(
      decoded,
      "apple.com",
      "auth.errors.appleTokenProviderMismatch",
    );
    return this.buildExternalIdentity(
      "apple",
      this.mapFirebaseTokenToExternalPayload(decoded),
    );
  }

  private mapFirebaseTokenToExternalPayload(
    decoded: DecodedIdToken,
  ): ExternalPayload {
    return {
      sub: decoded.uid || decoded.sub,
      email: decoded.email,
      email_verified: decoded.email_verified,
      name: decoded.name,
      picture: decoded.picture,
    };
  }

  private assertFirebaseProvider(
    decoded: DecodedIdToken,
    expectedProvider: "google.com" | "apple.com",
    errorKey: string,
  ): void {
    const provider = decoded.firebase?.sign_in_provider;
    if (provider !== expectedProvider) {
      throw this.unauthorized(errorKey);
    }
  }

  private async verifyFirebaseIdToken(
    idToken: string,
  ): Promise<DecodedIdToken> {
    try {
      const authClient = this.getFirebaseAuthClient();
      const checkRevoked =
        String(
          this.config.get<string>("FIREBASE_CHECK_REVOKED") || "false",
        ).toLowerCase() === "true";
      return await authClient.verifyIdToken(idToken, checkRevoked);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const { code, message } = error as { code?: string; message?: string };
      this.logger.warn(`Firebase ID token rejected: ${code ?? "unknown"} ${message ?? ""}`);
      throw this.unauthorized("auth.errors.invalidProviderIdToken");
    }
  }

  private getFirebaseAuthClient(): Auth {
    if (this.firebaseAuthClient) {
      return this.firebaseAuthClient;
    }

    const existingApps = getApps();
    if (existingApps.length > 0) {
      this.firebaseAuthClient = getAuth(existingApps[0]);
      return this.firebaseAuthClient;
    }

    const projectId = (
      this.config.get<string>("FIREBASE_PROJECT_ID") || ""
    ).trim();
    const clientEmail = (
      this.config.get<string>("FIREBASE_CLIENT_EMAIL") || ""
    ).trim();
    const privateKey = normalizeFirebasePrivateKey(
      this.config.get<string>("FIREBASE_PRIVATE_KEY") || "",
    );

    if (!projectId || !clientEmail || !privateKey) {
      throw this.badRequest("auth.errors.firebaseOauthNotConfigured");
    }

    try {
      const app = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      this.firebaseAuthClient = getAuth(app);
    } catch (error) {
      // A bad service-account key is a server problem; reporting it as an
      // invalid client token hides the real cause.
      this.logger.error(
        `Firebase Admin init failed: ${(error as Error).message}`,
      );
      throw this.badRequest("auth.errors.firebaseOauthNotConfigured");
    }
    return this.firebaseAuthClient;
  }

  private async increaseLoginAttempts(user: AppUserEntity): Promise<void> {
    const lockMinutes = Number(
      this.config.get<string>("AUTH_LOCKOUT_MINUTES") || 30,
    );
    const maxAttempts = Number(
      this.config.get<string>("AUTH_MAX_LOGIN_ATTEMPTS") || 5,
    );

    const nextAttempts = (user.loginAttemptCount || 0) + 1;
    user.loginAttemptCount = nextAttempts;

    if (nextAttempts >= maxAttempts) {
      user.lockoutUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
    }

    await this.appUserRepo.save(user);
  }

  private async upsertExternalAccount(
    userId: number,
    identity: ExternalIdentity,
  ): Promise<void> {
    const existing = await this.externalRepo.findOne({
      where: {
        provider: identity.provider,
        providerSubject: identity.subject,
      },
    });

    if (existing) {
      existing.userId = userId;
      existing.email = identity.email;
      existing.emailVerified = identity.emailVerified;
      existing.displayName = identity.displayName;
      existing.avatarUrl = identity.avatarUrl;
      existing.updatedAt = new Date();
      await this.externalRepo.save(existing);
      return;
    }

    await this.externalRepo.save(
      this.externalRepo.create({
        userId,
        provider: identity.provider,
        providerSubject: identity.subject,
        email: identity.email,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  }

  private async findUserByEmail(email: string): Promise<AppUserEntity | null> {
    const normalizedEmail = this.normalizeEmail(email);
    return this.appUserRepo.findOne({
      where: {
        email: Raw((alias) => `lower(${alias}) = :email`, {
          email: normalizedEmail,
        }),
        delFlag: false,
      },
    });
  }

  private async findUserByExternal(
    provider: string,
    subject: string,
  ): Promise<AppUserEntity | null> {
    const external = await this.externalRepo.findOne({
      where: {
        provider,
        providerSubject: subject,
      },
    });

    if (!external) {
      return null;
    }

    return this.appUserRepo.findOne({
      where: {
        id: external.userId,
        delFlag: false,
      },
    });
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private normalizeEmail(email: string): string {
    return String(email || "")
      .trim()
      .toLowerCase();
  }

  private async releaseDeletedEmail(email: string): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) {
      return;
    }

    await this.appUserRepo
      .createQueryBuilder()
      .update(AppUserEntity)
      .set({ email: null, updatedAt: new Date() })
      .where('lower("Email") = :email AND "DelFlag" = true', {
        email: normalizedEmail,
      })
      .execute();
  }

  private isUniqueConstraintError(error: unknown, constraint: string): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as
      | { code?: string; constraint?: string }
      | undefined;
    return (
      driverError?.code === "23505" && driverError.constraint === constraint
    );
  }

  private async hashPassword(password: string): Promise<string> {
    const rounds = Number(this.config.get<string>("BCRYPT_ROUNDS") || 10);
    return bcrypt.hash(password, rounds);
  }

  private parseDurationSeconds(value: string): number {
    const match = /^([0-9]+)([smhd])$/.exec(value.trim());
    if (!match) {
      return 900;
    }

    const amount = Number(match[1]);
    const unit = match[2];

    if (unit === "s") return amount;
    if (unit === "m") return amount * 60;
    if (unit === "h") return amount * 60 * 60;
    return amount * 60 * 60 * 24;
  }

  private buildExternalIdentity(
    provider: ExternalProvider,
    payload: ExternalPayload,
  ): ExternalIdentity {
    const subject = String(payload.sub || "").trim();
    if (!subject) {
      throw this.unauthorized("auth.errors.providerTokenMissingSubject");
    }

    const email =
      typeof payload.email === "string"
        ? this.normalizeEmail(payload.email)
        : null;
    const emailVerified =
      payload.email_verified === true || payload.email_verified === "true";
    const displayName = typeof payload.name === "string" ? payload.name : null;
    const avatarUrl =
      typeof payload.picture === "string" ? payload.picture : null;

    return {
      provider,
      subject,
      email,
      emailVerified,
      displayName,
      avatarUrl,
    };
  }

  private toAuthUser(user: AppUserEntity): AuthUser {
    return {
      id: Number(user.id),
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      status: user.status,
      isProfileComplete: user.isProfileComplete,
      age: user.age,
      gender: user.sex,
      heightCm: user.height,
      currentWeightKg: user.weight,
      goalWeightKg: user.goalWeight,
      activityLevel: user.fitnessLevel,
      mealPlanningFrequency: user.dietType,
      barriers: user.allergies ?? [],
      mealSplits: percentMealSplits(user.mealSplits),
    };
  }

  private buildDisplayNameFromEmail(email: string): string {
    const username = email.split("@")[0] || "User";
    return username.length >= 2 ? username : "User";
  }

  private buildDisplayNameFromProvider(provider: ExternalProvider): string {
    if (provider === "google") return "Google User";
    return "Apple User";
  }

  private errorBody(key: string): { errorKey: string; message: string } {
    return {
      errorKey: key,
      message: AUTH_ERROR_MESSAGES[key] ?? key,
    };
  }

  private badRequest(key: string): BadRequestException {
    return new BadRequestException(this.errorBody(key));
  }

  private unauthorized(key: string): UnauthorizedException {
    return new UnauthorizedException(this.errorBody(key));
  }

  private conflict(key: string): ConflictException {
    return new ConflictException(this.errorBody(key));
  }

  private unprocessable(key: string): UnprocessableEntityException {
    return new UnprocessableEntityException(this.errorBody(key));
  }
}
