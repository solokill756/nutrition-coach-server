import { IsBoolean } from "class-validator";

export class UpdateFoodVerifyRequestDto {
  @IsBoolean()
  isVerified!: boolean;
}
