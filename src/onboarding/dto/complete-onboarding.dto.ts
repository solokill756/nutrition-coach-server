import { IsOptional, IsString } from "class-validator";

export class CompleteOnboardingDto {
  @IsOptional()
  @IsString()
  note?: string;
}
