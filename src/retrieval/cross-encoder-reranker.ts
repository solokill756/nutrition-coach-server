import { DomainDoc } from "./retrieval.types";
import { OllamaService } from "../ollama/ollama.service";
import { RETRIEVAL_PROMPTS } from "./constants/retrieval-prompts";
import { ConfigService } from "@nestjs/config";

// Keeps the LLM prompt short: 10 passages x 900 chars (~12k chars) took 16-20 s per request.
const CROSS_ENCODER_LITE_TOPK = 6;
const CROSS_ENCODER_LITE_MAX_CHARS = 500;

export class CrossEncoderReranker {
  private crossEncoderLiteEnabled = true;

  constructor(
    private readonly ollamaService: OllamaService,
    private readonly config: ConfigService,
  ) {
    this.crossEncoderLiteEnabled = String(
      config.get<string>("RETRIEVAL_CROSS_ENCODER_LITE_ENABLED") || "true"
    ).toLowerCase() === "true";
  }

  isEnabled(): boolean {
    return this.crossEncoderLiteEnabled;
  }

  /** `docs` must be ordered best first: only the first CROSS_ENCODER_LITE_TOPK are scored. */
  async rerank(
    question: string,
    docs: DomainDoc[],
  ): Promise<Map<string, number>> {
    if (!this.crossEncoderLiteEnabled || !docs.length) {
      return new Map<string, number>();
    }

    const compactDocs = docs.slice(0, CROSS_ENCODER_LITE_TOPK).map((doc, index) => ({
      idx: index + 1,
      id: doc.id,
      title: String(doc.title || "").slice(0, 180),
      domain: String(doc.metadata?.domain || "unknown"),
      content: String(doc.content || "").replace(/\s+/g, " ").slice(0, CROSS_ENCODER_LITE_MAX_CHARS),
    }));

    const prompt = RETRIEVAL_PROMPTS.CROSS_ENCODER(question, compactDocs);

    try {
      const raw = await this.ollamaService.chat([
        { role: "system", content: "You are a strict reranker. Output valid JSON array only." },
        { role: "user", content: prompt },
      ]);
      const parsed = this.parseResponse(raw);
      return new Map<string, number>(parsed.map((item) => [item.id, item.score]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[RETRIEVAL] ⚠️ Cross-encoder lite rerank failed:", message);
      return new Map<string, number>();
    }
  }

  private parseResponse(raw: string): Array<{ id: string; score: number }> {
    const match = String(raw || "").match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const value = JSON.parse(match[0]);
      if (!Array.isArray(value)) return [];
      const rows: Array<{ id: string; score: number }> = [];
      for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const id = String((item as any).id || "").trim();
        const scoreRaw = Number((item as any).score);
        if (!id || Number.isNaN(scoreRaw)) continue;
        rows.push({ id, score: Math.max(0, Math.min(1, scoreRaw)) });
      }
      return rows;
    } catch {
      return [];
    }
  }
}
