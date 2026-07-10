import { Controller, Get, Query } from "@nestjs/common";
import { RetrievalService } from "./retrieval.service";
import type { HybridSearchMode } from "./retrieval.types";

@Controller("rag")
export class RagEvaluateController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Get("evaluate")
  async evaluate(
    @Query("q") q: string,
    @Query("mode") mode: string,
    @Query("topK") topKStr: string,
    @Query("expand") expand: string,
  ) {
    const topK = Math.min(Math.max(Number(topKStr) || 5, 1), 20);
    const forceMode: HybridSearchMode =
      mode === "bm25-only" ? "bm25-only"
      : mode === "vector-only" ? "vector-only"
      : "hybrid";
    const skipExpansion = expand !== "true";

    const t0 = Date.now();
    const results = await this.retrievalService.retrieve(
      q || "",
      topK,
      { skipExpansion, skipCrossEncoder: skipExpansion },
      forceMode,
    );
    const elapsed_ms = Date.now() - t0;

    return {
      mode: forceMode,
      query: q || "",
      topK,
      elapsed_ms,
      results: results.slice(0, topK).map((r) => ({
        id: r.id,
        title: r.title,
        domain: r.domain,
        score: Math.round(r.score * 1000) / 1000,
        content: r.content?.slice(0, 200),
      })),
    };
  }
}
