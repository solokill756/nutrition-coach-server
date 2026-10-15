import { IsOptional, IsString, MinLength } from "class-validator";

export class RefreshDto {
  // Web clients send it as the cc_refresh cookie instead of in the body.
  @IsOptional()
  @IsString()
  @MinLength(20)
  refreshToken?: string;

  @IsOptional()
  @IsString()
  deviceInfo?: string;
}
