import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { parseOrigins } from "../common/http/cors-options";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { LogoutDto } from "./dto/logout.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { OauthDto } from "./dto/oauth.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AuthService } from "./auth.service";
import {
  assertAllowedOrigin,
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
  wantsCookieTransport
} from "./cookie-transport";

type IssuedTokens = { refreshToken: string };

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) { }

  @Post("register")
  async register(
    @Body() body: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.deliver(req, res, await this.authService.register(body));
  }

  @Post("login")
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.deliver(req, res, await this.authService.login(body, this.resolveIp(req)));
  }

  @Post("oauth/google")
  async oauthGoogle(
    @Body() body: OauthDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.deliver(req, res, await this.authService.oauthGoogle(body, this.resolveIp(req)));
  }

  @Post("oauth/apple")
  async oauthApple(
    @Body() body: OauthDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.deliver(req, res, await this.authService.oauthApple(body, this.resolveIp(req)));
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async me(@Req() req: Request & { user: { userId: number } }) {
    return this.authService.me(req.user.userId);
  }

  @Post("refresh")
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!wantsCookieTransport(req)) {
      return this.authService.refresh(body, this.resolveIp(req));
    }
    assertAllowedOrigin(req, this.allowedOrigins());
    const issued = await this.authService.refresh(
      { refreshToken: readRefreshCookie(req), deviceInfo: body.deviceInfo },
      this.resolveIp(req),
    );
    return this.deliver(req, res, issued);
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @Body() body: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!wantsCookieTransport(req)) {
      return this.authService.logout(body.refreshToken);
    }
    assertAllowedOrigin(req, this.allowedOrigins());
    clearRefreshCookie(res, this.cookieSecure());
    return this.authService.logout(readRefreshCookie(req));
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout-all")
  async logoutAll(
    @Req() req: Request & { user: { userId: number } },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (wantsCookieTransport(req)) {
      assertAllowedOrigin(req, this.allowedOrigins());
      clearRefreshCookie(res, this.cookieSecure());
    }
    return this.authService.logoutAll(req.user.userId);
  }

  @Post("forgot-password")
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body);
  }

  @Post("reset-password")
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body);
  }

  /** Cookie clients get the refresh token as an HttpOnly cookie instead of in the body. */
  private deliver<T extends IssuedTokens>(
    req: Request,
    res: Response,
    issued: T,
  ): T | Omit<T, "refreshToken"> {
    if (!wantsCookieTransport(req)) {
      return issued;
    }
    setRefreshCookie(res, issued.refreshToken, this.cookieSecure());
    const { refreshToken: _sentAsCookie, ...body } = issued;
    return body;
  }

  private allowedOrigins(): string[] {
    return parseOrigins(this.config.get<string>("CORS_ORIGINS"));
  }

  private cookieSecure(): boolean {
    return String(this.config.get<string>("AUTH_COOKIE_SECURE") ?? "true").toLowerCase() !== "false";
  }

  private resolveIp(req: Request): string | undefined {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim().length > 0) {
      return forwarded.split(",")[0].trim();
    }

    return req.ip;
  }
}
