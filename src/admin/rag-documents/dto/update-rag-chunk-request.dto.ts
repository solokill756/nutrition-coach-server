import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import { RagDomain, RagTags } from "../../../rag-ingest/rag-taxonomy";

export class UpdateRagChunkRequestDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  content?: string;

  /** Validated against RAG_DOMAINS in the service (RAG_INVALID_DOMAIN). */
  @IsOptional()
  @IsString()
  domain?: RagDomain;

  /** Validated with sanitizeTags in the service (RAG_INVALID_TAG). */
  @IsOptional()
  @IsObject()
  tags?: Partial<RagTags>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
