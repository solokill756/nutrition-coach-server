import { Transform } from "class-transformer";
import { IsBoolean, IsIn, IsOptional } from "class-validator";

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value as boolean;
}

export class RagChunkListQueryDto {
  @IsOptional()
  @IsIn(["text", "table", "image"])
  blockKind?: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  needsReview?: boolean;

  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}
