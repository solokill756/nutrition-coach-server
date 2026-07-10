import { IsDateString, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateDiaryNoteDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
