import { IsOptional, IsString, MinLength } from "class-validator";

export class OauthDto {
  @IsString()
  @MinLength(20)
  idToken!: string;

  @IsOptional()
  @IsString()
  deviceInfo?: string;
}
