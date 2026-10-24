import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { RAG_DOMAINS, RAG_TAXONOMY, emptyTags, isRagDomain, type RagTagGroup } from "../rag-taxonomy";
import { tagInputText, type RagTagger, type TagInput, type TagResult } from "./tagger.types";

const DEFAULT_URL = "https://api.typesafe.ai/v1";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_THRESHOLD = 0.5;
const STATE_MAX_CHARS = 6000;
const BACKOFF_MS = [1000, 2000, 4000];
const REQUEST_TIMEOUT_MS = 60_000;

type Json = Record<string, any>;

export class JevRequestError extends Error {
  constructor(public readonly status?: number) {
    super(`Jev request failed (status ${status ?? "network"})`);
    this.name = "JevRequestError";
  }
}

@Injectable()
export class JevTagger implements RagTagger {
  readonly name = "jev" as const;

  constructor(private readonly config: ConfigService) {}

  async tag(input: TagInput): Promise<TagResult> {
    const data = await this.post(tagInputText(input, STATE_MAX_CHARS));
    return this.toResult(data);
  }

  private buildQuestions(): Json {
    const questions: Json = {
      domain: {
        type: "choice",
        instructions: "Which kind of nutrition knowledge does this passage mainly contain?",
        criteria: Object.fromEntries(RAG_DOMAINS.map((d) => [d.key, d.description])),
      },
    };
    for (const [group, items] of Object.entries(RAG_TAXONOMY)) {
      for (const item of items) {
        questions[`${group}__${item.key}`] = { type: "noul", instructions: item.description };
      }
    }
    return questions;
  }

  private async post(state: string): Promise<Json> {
    const baseUrl = (this.config.get<string>("TYPESAFE_API_URL") || DEFAULT_URL).replace(/\/+$/, "");
    const apiKey = this.config.get<string>("TYPESAFE_API_KEY") ?? "";
    const body = {
      state,
      model: this.config.get<string>("JEV_MODEL") || DEFAULT_MODEL,
      questions: this.buildQuestions(),
    };
    const opts = {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      timeout: REQUEST_TIMEOUT_MS,
    };

    for (let attempt = 0; ; attempt++) {
      try {
        const res = await axios.post(`${baseUrl}/systemone`, body, opts);
        return res.data as Json;
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        const retryable = status === undefined || status === 429 || status >= 500;
        // Never rethrow the raw axios error: it carries config.headers.Authorization.
        if (!retryable || attempt >= BACKOFF_MS.length) throw new JevRequestError(status);
        await this.sleep(BACKOFF_MS[attempt]);
      }
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private threshold(): number {
    const t = Number(this.config.get<string>("RAG_TAG_THRESHOLD"));
    return Number.isFinite(t) && t > 0 ? t : DEFAULT_THRESHOLD;
  }

  private toResult(data: Json): TagResult {
    const answers: Json = data?.answers && typeof data.answers === "object" ? data.answers : {};
    const domainAnswer = answers.domain;
    const domain = domainAnswer?.choice;
    if (!isRagDomain(domain)) {
      throw new Error(`Jev returned no valid domain answer (got ${JSON.stringify(domainAnswer?.choice ?? null)})`);
    }

    const scores: Record<string, number> = {};
    const probs: Json = domainAnswer.probabilities && typeof domainAnswer.probabilities === "object" ? domainAnswer.probabilities : {};
    for (const d of RAG_DOMAINS) {
      const p = Number(probs[d.key]);
      scores[`domain:${d.key}`] = Number.isFinite(p) ? p : d.key === domain ? 1 : 0;
    }

    const threshold = this.threshold();
    const tags = emptyTags();
    for (const group of Object.keys(RAG_TAXONOMY) as RagTagGroup[]) {
      for (const item of RAG_TAXONOMY[group]) {
        const raw = Number(answers[`${group}__${item.key}`]?.noul);
        const score = Number.isFinite(raw) ? raw : 0;
        scores[`${group}:${item.key}`] = score;
        if (score >= threshold) tags[group].push(item.key);
      }
    }
    return { domain, tags, scores, tagger: "jev" };
  }
}
