import { IsOptional, IsString } from "class-validator";

export class LogoutDto {
  // Mobile clients send it here; web clients send the cc_refresh cookie.
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
