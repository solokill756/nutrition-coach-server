import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { JwtAccessPayload } from "./auth.types";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly config: ConfigService) {
    const secret = config.get<string>("JWT_SECRET") || "dev-access-secret-change-me";

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret
    });
  }

  async validate(payload: JwtAccessPayload & { sub: number | string }) {
    const userId = Number(payload?.sub);
    if (!payload || payload.type !== "access" || !Number.isFinite(userId) || userId <= 0) {
      throw new UnauthorizedException(
        {
          errorKey: "auth.errors.invalidAccessToken",
          message: "Invalid access token"
        }
      );
    }

    return {
      userId,
      email: payload.email
    };
  }
}
