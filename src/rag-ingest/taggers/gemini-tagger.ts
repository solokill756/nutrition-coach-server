import { Injectable } from "@nestjs/common";
import { OllamaService } from "../../ollama/ollama.service";
import { RAG_DOMAINS, RAG_TAXONOMY, isRagDomain, sanitizeTags, type RagDomain, type RagTagGroup } from "../rag-taxonomy";
import { tagInputText, type RagTagger, type TagInput, type TagResult } from "./tagger.types";

const TEXT_MAX_CHARS = 6000;

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (m ? m[1] : trimmed).trim();
}

@Injectable()
export class GeminiTagger implements RagTagger {
  readonly name = "gemini" as const;

  constructor(private readonly ollama: OllamaService) {}

  async tag(input: TagInput): Promise<TagResult> {
    const raw = await this.ollama.chat([
      { role: "system", content: this.systemPrompt() },
      { role: "user", content: tagInputText(input, TEXT_MAX_CHARS) },
    ]);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFence(raw));
    } catch {
      throw new Error("Gemini tagger returned unparseable JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Gemini tagger returned a non-object JSON value");
    }

    const obj = parsed as Record<string, unknown>;
    const domain: RagDomain = isRagDomain(obj.domain) ? obj.domain : "guidelines";
    const { tags } = sanitizeTags(obj);
    const scores: Record<string, number> = { [`domain:${domain}`]: 1 };
    for (const group of Object.keys(tags) as RagTagGroup[]) {
      for (const key of tags[group]) scores[`${group}:${key}`] = 1;
    }
    return { domain, tags, scores, tagger: "gemini" };
  }

  private systemPrompt(): string {
    const keys = (group: RagTagGroup) => RAG_TAXONOMY[group].map((i) => i.key).join(", ");
    return [
      "You classify a passage of nutrition knowledge. Respond with JSON only, no prose, no markdown.",
      'Shape: {"domain": string, "conditions": string[], "allergens": string[], "goals": string[], "nutrients": string[]}',
      `domain must be exactly one of: ${RAG_DOMAINS.map((d) => d.key).join(", ")}.`,
      `conditions (valid keys): ${keys("conditions")}`,
      `allergens (valid keys): ${keys("allergens")}`,
      `goals (valid keys): ${keys("goals")}`,
      `nutrients (valid keys): ${keys("nutrients")}`,
      "Only include keys the passage is clearly about. Use only the valid keys above; use [] when none apply.",
      'The message may start with a "Document title:" and a "Section:" line before the passage. The document title and section heading are context only:',
      "use them to tell which condition, group or goal the passage is about (a table often names it only in its heading), but tag the passage, never the title alone.",
    ].join("\n");
  }
}
