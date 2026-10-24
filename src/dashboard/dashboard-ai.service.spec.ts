import { DashboardAiService, DashboardAiSuggestionContext } from "./dashboard-ai.service";
import { OllamaService } from "../ollama/ollama.service";
import { UserReferenceService } from "../retrieval/user-reference.service";
import { buildLlmUserProfile, formatLlmUserBlock } from "../nutrition/llm-user-profile";
import { sampleRecipeContext } from "../nutrition/__fixtures__/llm-context.fixture";

function makeCtx(): DashboardAiSuggestionContext {
  return {
    userContext: sampleRecipeContext(),
    calories: { target: 2000, consumed: 1600, burned: 0, net: 1600, remaining: 400, status: "on_track" },
    macros: {
      protein: { current: 80, target: 100 },
      carbs: { current: 180, target: 250 },
      fat: { current: 55, target: 67 },
    },
    exercise: { caloriesBurned: 0, minutes: 0, workoutCount: 0 },
    water: { currentMl: 400, targetMl: 2200 },
    remaining: 400,
    alerts: [],
  };
}

function setup(chat: jest.Mock) {
  const retrieve = jest.fn().mockResolvedValue({ text: "[1] Lower sodium meals", used: [] });
  const service = new DashboardAiService(
    { chat } as unknown as OllamaService,
    { retrieve } as unknown as UserReferenceService,
  );
  return { service, retrieve };
}

const OK = '{"title":"Plan dinner","message":"Choose a low-sodium dinner."}';

describe("DashboardAiService", () => {
  it("prompt has the shared user block with age", async () => {
    const chat = jest.fn().mockResolvedValue(OK);
    const { service } = setup(chat);
    const ctx = makeCtx();

    await service.buildAiSuggestion(ctx);

    const user = chat.mock.calls[0][0][1].content as string;
    expect(user).toContain(formatLlmUserBlock(buildLlmUserProfile(ctx.userContext)));
    expect(user).toContain('"age":34');
  });

  it("prompt has dashboard-only data", async () => {
    const chat = jest.fn().mockResolvedValue(OK);
    const { service } = setup(chat);

    await service.buildAiSuggestion(makeCtx());

    const user = chat.mock.calls[0][0][1].content as string;
    expect(user).toContain("Dashboard today (JSON):\n");
    expect(user).toContain('"water"');
  });

  // #37: the LLM rerank took 4-16 s of the dashboard's budget for a one-sentence suggestion.
  it("uses shared RAG with dashboard purpose, without the LLM rerank", async () => {
    const chat = jest.fn().mockResolvedValue(OK);
    const { service, retrieve } = setup(chat);

    await service.buildAiSuggestion(makeCtx());

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "dashboard_suggestion" }),
      { skipCrossEncoder: true },
    );
    expect(chat.mock.calls[0][0][1].content).toContain("[1] Lower sodium meals");
  });

  describe("20 s budget", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });
    const later = <T>(ms: number, value: T) => () => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

    // #37: the timeout wrapped only the LLM call, so a slow retrieval let requests run 28-35 s.
    it("covers retrieval too: 15 s retrieval + 10 s LLM falls back at 20 s", async () => {
      jest.spyOn(console, "log").mockImplementation(() => undefined);
      const chat = jest.fn(later(10_000, OK));
      const retrieve = jest.fn(later(15_000, { text: "None.", used: [] }));
      const service = new DashboardAiService({ chat } as unknown as OllamaService, { retrieve } as unknown as UserReferenceService);
      const ctx = makeCtx();
      const result = service.buildAiSuggestion(ctx);
      await jest.advanceTimersByTimeAsync(20_000);
      expect(await result).toEqual(
        service.buildFallbackSuggestion({
          remaining: ctx.remaining,
          alerts: ctx.alerts,
          waterCurrentMl: ctx.water.currentMl,
          waterTargetMl: ctx.water.targetMl,
          workoutCount: ctx.exercise.workoutCount,
        }),
      );
    });

    it("returns the LLM suggestion when retrieval and the LLM fit in 20 s together", async () => {
      const chat = jest.fn(later(8_000, OK));
      const retrieve = jest.fn(later(10_000, { text: "None.", used: [] }));
      const service = new DashboardAiService({ chat } as unknown as OllamaService, { retrieve } as unknown as UserReferenceService);
      const result = service.buildAiSuggestion(makeCtx());
      await jest.advanceTimersByTimeAsync(18_000);
      expect(await result).toEqual({ title: "Plan dinner", message: "Choose a low-sodium dinner." });
    });
  });

  it("falls back when the LLM fails", async () => {
    const chat = jest.fn().mockRejectedValue(new Error("LLM unavailable"));
    const { service } = setup(chat);
    const ctx = makeCtx();

    const result = await service.buildAiSuggestion(ctx);

    expect(result).toEqual(
      service.buildFallbackSuggestion({
        remaining: ctx.remaining,
        alerts: ctx.alerts,
        waterCurrentMl: ctx.water.currentMl,
        waterTargetMl: ctx.water.targetMl,
        workoutCount: ctx.exercise.workoutCount,
      }),
    );
  });
});
