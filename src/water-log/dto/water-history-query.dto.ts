import { IsDateString } from "class-validator";

export class WaterHistoryQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
