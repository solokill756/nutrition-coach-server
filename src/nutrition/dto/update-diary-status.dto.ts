import { IsBoolean, IsDateString } from "class-validator";

export class UpdateDiaryStatusDto {
  @IsDateString()
  date!: string;

  @IsBoolean()
  isCompleted!: boolean;
}
