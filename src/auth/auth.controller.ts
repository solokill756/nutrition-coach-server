import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { Request } from "express";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { OauthDto } from "./dto/oauth.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post("register")
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post("login")
  async login(@Body() body: LoginDto, @Req() req: Request) {
    return this.authService.login(body, this.resolveIp(req));
  }

  @Post("oauth/google")
  async oauthGoogle(@Body() body: OauthDto, @Req() req: Request) {
    return this.authService.oauthGoogle(body, this.resolveIp(req));
  }

  @Post("oauth/apple")
  async oauthApple(@Body() body: OauthDto, @Req() req: Request) {
    return this.authService.oauthApple(body, this.resolveIp(req));
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async me(@Req() req: Request & { user: { userId: number } }) {
    return this.authService.me(req.user.userId);
  }

  @Post("refresh")
  async refresh(@Body() body: RefreshDto, @Req() req: Request) {
    return this.authService.refresh(body, this.resolveIp(req));
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout-all")
  async logoutAll(@Req() req: Request & { user: { userId: number } }) {
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

  private resolveIp(req: Request): string | undefined {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim().length > 0) {
      return forwarded.split(",")[0].trim();
    }

    return req.ip;
  }
}
