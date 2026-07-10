import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, IsUrl, MinLength, ValidateIf } from "class-validator";

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  /** Plain password; validated in AuthService (min 8 chars → 422 if weak). */
  @IsOptional()
  @IsString()
  newPassword?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @ValidateIf((_, value) => value !== undefined && value !== "")
  @IsUrl({ require_protocol: true }, { message: "avatarUrl must be a valid URL" })
  avatarUrl?: string;
}
