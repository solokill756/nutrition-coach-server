import { IsOptional, IsString, MinLength } from "class-validator";

export class RefreshDto {
  @IsString()
  @MinLength(20)
  refreshToken!: string;

  @IsOptional()
  @IsString()
  deviceInfo?: string;
}
