import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GeminiTagger } from "./gemini-tagger";
import { JevTagger } from "./jev-tagger";
import type { TagResult } from "./tagger.types";

const MAX_CONSECUTIVE_JEV_FAILURES = 3;

@Injectable()
export class TaggingService {
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
        } catch {
          consecutiveJevFailures++;
          if (consecutiveJevFailures >= MAX_CONSECUTIVE_JEV_FAILURES) {
            useGemini = true;
            warnings.push(`Jev failed repeatedly; switched to Gemini tagger at chunk ${i + 1}`);
          }
        }
      }
      if (!result) result = await this.tryGemini(texts[i]);
      results.push(result);
      onProgress?.(i + 1, texts.length);
    }
    return { results, warnings };
  }

  async tagOne(text: string): Promise<TagResult> {
    if (!this.forcedGemini() && this.hasJevKey()) {
      try {
        return await this.jev.tag(text);
      } catch {
        // fall through to Gemini
      }
    }
    return this.gemini.tag(text);
  }

  private async tryGemini(text: string): Promise<TagResult | null> {
    try {
      return await this.gemini.tag(text);
    } catch {
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
