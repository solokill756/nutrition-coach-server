import { RagDomain, RagTagGroup, RagTags, RagTaxonomyItem } from "../../../rag-ingest/rag-taxonomy";

export type RagJobDto = {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  stage: string | null;
  progress: number;
  errorMessage: string | null;
  warnings: string[];
  startedAt: string | null;
  finishedAt: string | null;
};

export type RagDocumentDto = {
  id: string;
  sourceType: "url" | "pdf";
  sourceUrl: string | null;
  originalFilename: string | null;
  title: string;
  language: "en" | "vi" | "mixed" | null;
  status: "pending" | "processing" | "ready" | "failed";
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  latestJob: RagJobDto | null;
};

export type RagChunkDto = {
  id: string;
  documentId: string;
  headingPath: string;
  pageFrom: number | null;
  pageTo: number | null;
  blockKind: "text" | "table" | "image";
  language: "en" | "vi" | null;
  domain: RagDomain;
  tags: RagTags;
  tagScores: Record<string, number>;
  tagger: string | null;
  tagFailed: boolean;
  content: string;
  hasImage: boolean;
  isActive: boolean;
  isManuallyEdited: boolean;
  needsReview: boolean;
  updatedAt: string;
};

export type RagTaxonomyDto = {
  domains: RagTaxonomyItem[];
  groups: Record<RagTagGroup, RagTaxonomyItem[]>;
};

export type RagDocumentEnvelope = { success: true; data: RagDocumentDto };
export type RagDocumentCreateEnvelope = { success: true; data: RagDocumentDto; created: boolean };
export type RagDocumentListEnvelope = {
  success: true;
  data: RagDocumentDto[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};
export type RagChunkEnvelope = { success: true; data: RagChunkDto };
export type RagChunkListEnvelope = { success: true; data: RagChunkDto[] };
