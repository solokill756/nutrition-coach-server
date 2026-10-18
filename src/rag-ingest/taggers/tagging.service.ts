import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GeminiTagger } from "./gemini-tagger";
import { JevTagger } from "./jev-tagger";
import type { TagResult } from "./tagger.types";

const MAX_CONSECUTIVE_JEV_FAILURES = 3;

/** Short, secret-free description of a failure. Never serialize the error object (axios errors hold the Bearer key). */
function describeError(err: unknown): { status?: number; reason: string } {
  const e = err as { status?: unknown; response?: { status?: unknown }; message?: unknown } | null;
  const raw = e?.status ?? e?.response?.status;
  const status = typeof raw === "number" ? raw : undefined;
  if (status !== undefined) return { status, reason: `HTTP ${status}` };
  const msg = typeof e?.message === "string" ? e.message.replace(/\s+/g, " ").slice(0, 120) : "unknown error";
  return { reason: msg };
}

@Injectable()
export class TaggingService {
  private readonly logger = new Logger(TaggingService.name);

  constructor(
    private readonly jev: JevTagger,
    private readonly gemini: GeminiTagger,
    private readonly config: ConfigService,
  ) {}

  async tagAll(
    texts: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ results: (TagResult | null)[]; warnings: string[] }> {
    const results: (TagResult | null)[] = [];
    const warnings: string[] = [];
    let useGemini = false;

    if (this.forcedGemini()) {
      useGemini = true;
    } else if (!this.hasJevKey()) {
      useGemini = true;
      warnings.push("TYPESAFE_API_KEY is not set; using Gemini tagger");
    }

    let consecutiveJevFailures = 0;
    for (let i = 0; i < texts.length; i++) {
      let result: TagResult | null = null;
      if (!useGemini) {
        try {
          result = await this.jev.tag(texts[i]);
          consecutiveJevFailures = 0;
        } catch (err) {
          const d = describeError(err);
          this.logger.warn(`jev failed on chunk ${i + 1}: ${d.reason}`);
          consecutiveJevFailures++;
          if (consecutiveJevFailures >= MAX_CONSECUTIVE_JEV_FAILURES) {
            useGemini = true;
            const suffix = d.status !== undefined ? ` (last Jev error: HTTP ${d.status})` : "";
            warnings.push(`Jev failed repeatedly; switched to Gemini tagger at chunk ${i + 1}${suffix}`);
          }
        }
      }
      if (!result) result = await this.tryGemini(texts[i], i + 1);
      results.push(result);
      onProgress?.(i + 1, texts.length);
    }
    return { results, warnings };
  }

  async tagOne(text: string): Promise<TagResult> {
    if (!this.forcedGemini() && this.hasJevKey()) {
      try {
        return await this.jev.tag(text);
      } catch (err) {
        this.logger.warn(`jev failed on retag: ${describeError(err).reason}; trying gemini`);
      }
    }
    try {
      return await this.gemini.tag(text);
    } catch (err) {
      this.logger.warn(`gemini failed on retag: ${describeError(err).reason}`);
      throw err;
    }
  }

  private async tryGemini(text: string, chunkNo: number): Promise<TagResult | null> {
    try {
      return await this.gemini.tag(text);
    } catch (err) {
      this.logger.warn(`gemini failed on chunk ${chunkNo}: ${describeError(err).reason}`);
      return null;
    }
  }

  private forcedGemini(): boolean {
    return String(this.config.get<string>("RAG_TAGGER") ?? "").trim().toLowerCase() === "gemini";
  }

  private hasJevKey(): boolean {
    return String(this.config.get<string>("TYPESAFE_API_KEY") ?? "").trim().length > 0;
  }
}
