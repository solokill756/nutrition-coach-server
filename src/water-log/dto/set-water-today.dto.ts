import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";

/** Set total intake for today (UTC calendar day). Allows 0 to clear. */
export class SetWaterTodayDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20000)
  amountMl!: number;
}
