import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RetrievalService } from "./retrieval.service";
import { buildPersonalizedRagQuery, type PersonalizedRagQueryInput } from "./personalized-rag-query";
import { buildRagReferenceBlock } from "./rag-reference-block";
import { RAG_CONFIDENCE_THRESHOLD } from "./rag-confidence";
import { RAG_PROMPT_TOP_K_DEFAULT, RAG_REFERENCE_MAX_CHARS } from "./rag-prompt-config";
import type { RetrievalResult } from "./retrieval.types";

export type UserReferences = { text: string; used: RetrievalResult[] };

/**
 * One RAG retrieval path for every LLM prompt (Dashboard AI, Recipe Builder,
 * Staple allocation): same query, top-K, score threshold and size cap.
 */
@Injectable()
export class UserReferenceService {
  private readonly logger = new Logger(UserReferenceService.name);

  constructor(
    private readonly retrieval: RetrievalService,
    private readonly config: ConfigService,
  ) {}

  async retrieve(input: PersonalizedRagQueryInput): Promise<UserReferences> {
    try {
      const { question, hints } = buildPersonalizedRagQuery(input);
      const topK = Number(this.config.get("TOP_K")) || RAG_PROMPT_TOP_K_DEFAULT;
      this.logger.debug(
        `[RAG] Query purpose=${input.purpose} hints=${JSON.stringify(hints)} query="${question}"`,
      );
      const contexts = await this.retrieval.retrieve(question, topK, hints);
      const filtered = contexts.filter((c) => c.score >= RAG_CONFIDENCE_THRESHOLD);
      this.logger.log(
        `[RAG] RetrievalService.retrieve purpose=${input.purpose} intent=${hints.intent ?? "general"} ` +
          `hasConditionContext=${hints.hasConditionContext ?? false} ` +
          `rawHits=${contexts.length} usedAfterScore>=${RAG_CONFIDENCE_THRESHOLD}=${filtered.length} ` +
          `topScore=${contexts[0]?.score != null ? contexts[0].score.toFixed(3) : "n/a"}`,
      );
      if (contexts.length > 0 && filtered.length === 0) {
        this.logger.warn(
          `[RAG] All ${contexts.length} chunks scored below ${RAG_CONFIDENCE_THRESHOLD}; LLM prompt Reference section will be empty.`,
        );
      }
      return buildRagReferenceBlock(filtered, RAG_REFERENCE_MAX_CHARS);
    } catch (err) {
      this.logger.warn(`[RAG] Retrieval failed, continuing without references: ${(err as Error)?.message ?? err}`);
      return { text: "None.", used: [] };
    }
  }
}
