import { HttpException, HttpStatus } from "@nestjs/common";

export type AdminRagErrorCode =
  | "RAG_DOCUMENT_NOT_FOUND"
  | "RAG_CHUNK_NOT_FOUND"
  | "RAG_IMAGE_NOT_FOUND"
  | "RAG_INVALID_URL"
  | "RAG_INVALID_FILE"
  | "RAG_FILE_TOO_LARGE"
  | "RAG_INVALID_TAG"
  | "RAG_INVALID_DOMAIN"
  | "RAG_JOB_IN_PROGRESS"
  | "RAG_TAGGING_FAILED"
  | "RAG_EMBEDDING_FAILED"
  | "VALIDATION_ERROR";

const ADMIN_RAG_ERROR_MESSAGES: Record<AdminRagErrorCode, string> = {
  RAG_DOCUMENT_NOT_FOUND: "Document not found",
  RAG_CHUNK_NOT_FOUND: "Chunk not found",
  RAG_IMAGE_NOT_FOUND: "Image not found",
  RAG_INVALID_URL: "Invalid URL; only http and https are supported",
  RAG_INVALID_FILE: "Invalid file; a PDF is required",
  RAG_FILE_TOO_LARGE: "File is too large",
  RAG_INVALID_TAG: "Invalid tag",
  RAG_INVALID_DOMAIN: "Invalid domain",
  RAG_JOB_IN_PROGRESS: "An ingest job is already pending or running for this document",
  RAG_TAGGING_FAILED: "Tagging failed",
  RAG_EMBEDDING_FAILED: "Chunk saved but re-embedding failed; retry the save",
  VALIDATION_ERROR: "Invalid input",
};

export class AdminRagException extends HttpException {
  constructor(
    readonly code: AdminRagErrorCode,
    status: HttpStatus,
    message = ADMIN_RAG_ERROR_MESSAGES[code],
  ) {
    super({ success: false, error: { code, message } }, status);
  }
}
