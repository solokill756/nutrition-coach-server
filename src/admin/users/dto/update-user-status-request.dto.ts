import { IsBoolean } from "class-validator";

export class UpdateUserStatusRequestDto {
  @IsBoolean()
  isActive!: boolean;
}
