import { IsString } from "class-validator";

export class UpdateUserGoalDto {
  @IsString()
  goalType!: string;
}
