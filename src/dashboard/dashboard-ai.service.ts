import { Injectable, Logger } from "@nestjs/common";
import { OllamaService } from "../ollama/ollama.service";
import { UserReferenceService } from "../retrieval/user-reference.service";
import { ragQueryInputFromContext } from "../retrieval/personalized-rag-query";
import type { RecipeGenerationContext } from "../nutrition/user-context.service";
import { buildLlmUserProfile, formatLlmUserBlock } from "../nutrition/llm-user-profile";
import { DashboardAlert } from "./dashboard-alert.service";

export type DashboardAiSuggestion = {
  title: string;
  message: string;
};

export type DashboardAiSuggestionContext = {
  userContext: RecipeGenerationContext;
  calories: {
    target: number;
    consumed: number;
    burned: number;
    net: number;
    remaining: number;
    status: string;
  };
  macros: {
    protein: { current: number; target: number };
    carbs: { current: number; target: number };
    fat: { current: number; target: number };
  };
  exercise: {
    caloriesBurned: number;
    minutes: number;
    workoutCount: number;
  };
  water: {
    currentMl: number;
    targetMl: number;
  };
  remaining: number;
  alerts: DashboardAlert[];
};

const AI_SUGGESTION_TIMEOUT_MS = 20000;
const AI_SUGGESTION_TITLE_MAX = 40;
const AI_SUGGESTION_MESSAGE_MAX = 180;

@Injectable()
export class DashboardAiService {
  private readonly logger = new Logger(DashboardAiService.name);

  constructor(
    private readonly ollamaService: OllamaService,
    private readonly userReferenceService: UserReferenceService,
  ) {}

  async buildAiSuggestion(ctx: DashboardAiSuggestionContext): Promise<DashboardAiSuggestion> {
    const fallback = this.buildFallbackSuggestion({
      remaining: ctx.remaining,
      alerts: ctx.alerts,
      waterCurrentMl: ctx.water.currentMl,
      waterTargetMl: ctx.water.targetMl,
      workoutCount: ctx.exercise.workoutCount,
    });
    // One budget for retrieval and the LLM call: past it the fallback is returned right away.
    const startedAt = Date.now();
    let usedFallback = false;
    try {
      const raw = await this.withTimeout(this.requestSuggestion(ctx), AI_SUGGESTION_TIMEOUT_MS);
      const parsed = this.parseAiSuggestion(raw);
      usedFallback = parsed == null;
      return parsed ?? fallback;
    } catch (error) {
      usedFallback = true;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI suggestion fallback: ${message}`);
      return fallback;
    } finally {
      this.logger.log(`[DASHBOARD-AI] latencyMs=${Date.now() - startedAt} fallback=${usedFallback}`);
    }
  }

  /** Retrieval plus the LLM call; not cancelled when the budget runs out, its result is just ignored. */
  private async requestSuggestion(ctx: DashboardAiSuggestionContext): Promise<string> {
    // No LLM rerank: it took 4-16 s of the budget for a one-sentence suggestion (#37).
    const references = await this.userReferenceService.retrieve(
      ragQueryInputFromContext(ctx.userContext, "dashboard_suggestion"),
      { skipCrossEncoder: true },
    );
    const systemPrompt = [
      "You are a concise nutrition coach for a daily dashboard.",
      "Return JSON only with exactly this shape: {\"title\":\"short title\",\"message\":\"one practical sentence\"}.",
      "Do not include markdown, code fences, medical diagnosis, treatment advice, or medication advice.",
      "Keep the title under 40 characters and the message under 180 characters.",
      "Base the suggestion only on the dashboard summary and retrieved reference snippets provided by the server.",
      "Do not state any number that is not in the dashboard summary or the references.",
      "If references are empty or not relevant, use only the dashboard summary.",
    ].join("\n");

    const userPrompt = [
      "Create one practical suggestion for today from this dashboard context.",
      formatLlmUserBlock(buildLlmUserProfile(ctx.userContext)),
      // Compact JSON: indentation is pure token overhead for the model.
      `Dashboard today (JSON):\n${JSON.stringify({
        calories: ctx.calories,
        macros: ctx.macros,
        water: ctx.water,
        exercise: ctx.exercise,
        alerts: ctx.alerts.map((a) => ({
          nutrient: a.nutrientType,
          severity: a.severity,
          current: a.current,
          limit: a.limit,
          unit: a.unit,
          percent: a.percent,
        })),
      })}`,
      `Retrieved reference snippets:\n${references.text}`,
    ].join("\n\n");

    return this.ollamaService.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
  }

  buildFallbackSuggestion(ctx: {
    remaining: number;
    alerts: DashboardAlert[];
    waterCurrentMl: number;
    waterTargetMl: number;
    workoutCount: number;
  }): DashboardAiSuggestion {
    const { remaining, alerts, waterCurrentMl, waterTargetMl, workoutCount } = ctx;

    if (remaining < 0) {
      return {
        title: "Calorie budget",
        message: "You exceeded your calorie target. Consider a lighter next meal.",
      };
    }

    const sodiumRed = alerts.some(
      (a) => a.severity === "critical" && a.nutrientType === "sodium",
    );
    if (sodiumRed) {
      return {
        title: "Dinner suggestion",
        message: "Choose a low-sodium dinner tonight because your sodium intake is high.",
      };
    }

    if (waterTargetMl > 0 && waterCurrentMl < waterTargetMl * 0.5) {
      return {
        title: "Hydration",
        message: "You are under half your water goal. Drink a glass of water soon.",
      };
    }

    if (workoutCount === 0) {
      return {
        title: "Movement",
        message: "No exercise logged today yet. A short walk can help energy and mood.",
      };
    }

    return {
      title: "Great progress",
      message: "You are on track today. Keep balanced meals and stay hydrated.",
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`AI suggestion timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle != null) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private parseAiSuggestion(raw: string): DashboardAiSuggestion | null {
    const jsonText = this.extractJsonObject(raw);
    if (jsonText == null) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(jsonText);
      if (!this.isRecord(parsed)) {
        return null;
      }

      const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
      const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
      if (!title || !message) {
        return null;
      }

      return {
        title: this.truncateForSuggestion(title, AI_SUGGESTION_TITLE_MAX),
        message: this.truncateForSuggestion(message, AI_SUGGESTION_MESSAGE_MAX),
      };
    } catch {
      return null;
    }
  }

  private extractJsonObject(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fenced?.[1]?.trim() ?? trimmed;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    return candidate.slice(start, end + 1);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private truncateForSuggestion(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.slice(0, maxLength).trimEnd();
  }
}
