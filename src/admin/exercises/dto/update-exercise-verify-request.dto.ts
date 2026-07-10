import { IsBoolean } from "class-validator";

export class UpdateExerciseVerifyRequestDto {
  @IsBoolean()
  isVerified!: boolean;
}
