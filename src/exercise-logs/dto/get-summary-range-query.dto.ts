import { IsDateString } from "class-validator";

export class GetSummaryRangeQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
