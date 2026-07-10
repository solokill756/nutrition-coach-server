import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import * as bcrypt from "bcrypt";
import { Raw, Repository } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";
import { AdminLoginRequestDto } from "./dto/admin-login-request.dto";
import { AdminLoginResponseDto } from "./dto/admin-login-response.dto";
import { AdminProfileResponseDto } from "./dto/admin-profile-response.dto";
import { AdminAuthException } from "./admin-auth.exception";

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(AppUserEntity)
    private readonly userRepo: Repository<AppUserEntity>,
  ) {}

  async login(dto: AdminLoginRequestDto): Promise<AdminLoginResponseDto> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.findUserByEmail(email);

    if (!user || !user.passwordHash) {
      throw new AdminAuthException("INVALID_CREDENTIALS", HttpStatus.UNAUTHORIZED);
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new AdminAuthException("INVALID_CREDENTIALS", HttpStatus.UNAUTHORIZED);
    }

    this.ensureAdminRole(user);
    this.ensureActive(user);

    user.lastLoginAt = new Date();
    await this.userRepo.save(user);

    this.logger.log(`Admin login succeeded for user ${user.id}`);

    return {
      success: true,
      data: {
        accessToken: await this.issueAccessToken(user),
        admin: this.toAdminProfile(user),
      },
    };
  }

  async me(userId: number): Promise<{ success: true; data: AdminProfileResponseDto }> {
    const user = await this.assertActiveAdmin(userId);

    return {
      success: true,
      data: this.toAdminProfile(user),
    };
  }

  async logout(userId: number): Promise<{ success: true; message: string }> {
    await this.assertActiveAdmin(userId);
    this.logger.log(`Admin logout for user ${userId}`);

    return {
      success: true,
      message: "Logged out successfully",
    };
  }

  async assertActiveAdmin(userId: number): Promise<AppUserEntity> {
    const user = await this.userRepo.findOne({
      where: { id: userId, delFlag: false },
    });

    if (!user) {
      throw new AdminAuthException("UNAUTHORIZED", HttpStatus.UNAUTHORIZED);
    }

    this.ensureAdminRole(user);
    this.ensureActive(user);

    return user;
  }

  private ensureAdminRole(user: AppUserEntity): void {
    if (user.role !== "admin") {
      throw new AdminAuthException("ADMIN_ONLY", HttpStatus.FORBIDDEN);
    }
  }

  private ensureActive(user: AppUserEntity): void {
    if (user.status === 0) {
      throw new AdminAuthException("ACCOUNT_BLOCKED", HttpStatus.FORBIDDEN);
    }

    if (user.status !== 1) {
      throw new AdminAuthException("ACCOUNT_BLOCKED", HttpStatus.FORBIDDEN);
    }
  }

  private async issueAccessToken(user: AppUserEntity): Promise<string> {
    const secret = this.config.get<string>("JWT_SECRET") || "dev-access-secret-change-me";
    const expiresIn = this.parseDurationSeconds(
      this.config.get<string>("JWT_ACCESS_EXPIRES_IN") || "15m",
    );

    return this.jwtService.signAsync(
      { sub: Number(user.id), email: user.email, type: "access" },
      { secret, expiresIn },
    );
  }

  private async findUserByEmail(email: string): Promise<AppUserEntity | null> {
    return this.userRepo.findOne({
      where: {
        email: Raw((alias) => `lower(${alias}) = :email`, { email }),
        delFlag: false,
      },
    });
  }

  private toAdminProfile(user: AppUserEntity): AdminProfileResponseDto {
    return {
      id: Number(user.id),
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: "admin",
    };
  }

  private normalizeEmail(email: string): string {
    return String(email || "").trim().toLowerCase();
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
}
