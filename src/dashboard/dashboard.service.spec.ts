import { DashboardService } from "./dashboard.service";
import { DashboardAlertService } from "./dashboard-alert.service";
import { DashboardAiService } from "./dashboard-ai.service";
import { OllamaService } from "../ollama/ollama.service";
import { UserReferenceService } from "../retrieval/user-reference.service";
import { UserContextService } from "../nutrition/user-context.service";
import { sampleRecipeContext } from "../nutrition/__fixtures__/llm-context.fixture";
import { DashboardEventBus } from "./dashboard-event-bus";

function createQueryBuilderMock() {
  const qb = {
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    getRawOne: jest.fn().mockResolvedValue({ sumCal: "0", sumMin: "0", cnt: "0" }),
  };
  return qb;
}

function createService(chat: jest.Mock<Promise<string>, [{ role: "system" | "user" | "assistant"; content: string }[]]>) {
  const userRepo = {
    findOne: jest.fn().mockResolvedValue({
      id: 1,
      displayName: "Alex",
      avatarUrl: null,
      age: 34,
      sex: "female",
      weight: 60,
      goalWeight: 58,
      fitnessLevel: "beginner",
    }),
  };
  const goalRepo = {
    findOne: jest.fn().mockResolvedValue({ targetCalories: 2000 }),
  };
  const conditionRepo = {
    find: jest.fn().mockResolvedValue([{ conditionName: "hypertension", severity: "medium", isActive: true }]),
  };
  const exerciseQueryBuilder = createQueryBuilderMock();
  const exerciseLogRepo = {
    createQueryBuilder: jest.fn(() => exerciseQueryBuilder),
  };
  const waterRepo = {
    findOne: jest.fn().mockResolvedValue({ amountMl: 400 }),
  };
  const logFoodRepo = {
    count: jest.fn().mockResolvedValue(1),
  };
  const thresholdRepo = {
    find: jest.fn().mockResolvedValue([
      { nutrient: "sodium", maxAmount: 1500, minAmount: 500, unit: "mg", isActive: true },
    ]),
  };
  const diaryService = {
    getDay: jest.fn().mockResolvedValue({
      totalCalories: 1600,
      totalProtein: 80,
      totalCarbs: 180,
      totalFat: 55,
      totalSodiumMg: 2500,
    }),
  };
  const nutritionCalculator = {
    macroBreakdownFromThresholds: jest.fn().mockReturnValue(null),
    macroBreakdownFromTargetCalories: jest.fn().mockReturnValue({
      proteinG: 100,
      carbsG: 250,
      fatG: 67,
    }),
  };
  const weightService = {
    hasEntryOnDate: jest.fn().mockResolvedValue(false),
    historyDescending: jest.fn().mockResolvedValue([]),
  };
  const hydrationTargetService = {
    calculateForProfile: jest.fn().mockReturnValue(2200),
  };
  const ollamaService = { chat } as unknown as OllamaService;
  const userReferenceService = {
    retrieve: jest.fn().mockResolvedValue({ text: "[1] Lower sodium meals (source: nutrition-guideline)", used: [] }),
  } as unknown as UserReferenceService;
  const userContext = sampleRecipeContext();
  const userContextService = {
    assembleRecipeGenerationContext: jest.fn().mockResolvedValue(userContext),
  } as unknown as UserContextService;
  const dashboardAiService = new DashboardAiService(ollamaService, userReferenceService);

  const service = new DashboardService(
    userRepo as never,
    goalRepo as never,
    conditionRepo as never,
    exerciseLogRepo as never,
    waterRepo as never,
    logFoodRepo as never,
    thresholdRepo as never,
    diaryService as never,
    nutritionCalculator as never,
    weightService as never,
    hydrationTargetService as never,
    new DashboardAlertService(),
    userContextService,
    dashboardAiService,
    new DashboardEventBus(),
  );

  return {
    service,
    chat,
    userContext,
    userReferenceService: userReferenceService as unknown as { retrieve: jest.Mock },
    userContextService: userContextService as unknown as { assembleRecipeGenerationContext: jest.Mock },
    dashboardAiService,
  };
}

describe("DashboardService AI suggestion", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("adds healthNutrients and keeps macros and micronutrients", async () => {
    const { service } = createService(jest.fn());
    const result = await service.getTodayDashboard(1, "2026-05-22");
    expect(result.healthNutrients.sodium).toEqual({ current: 2500, min: null, max: 1500, unit: "mg" });
    expect(result.macros.protein).toBeDefined();
    expect(result.micronutrients).toBeDefined();
  });

  it("does not block the dashboard payload on the LLM suggestion", async () => {
    const { service, chat } = createService(
      jest.fn().mockResolvedValue('{"title":"Plan dinner","message":"Choose a low-sodium dinner and drink water with it."}'),
    );

    const result = await service.getTodayDashboard(1, "2026-05-22");

    expect(chat).not.toHaveBeenCalled();
    expect(result.aiSuggestion).toEqual({
      title: "Dinner suggestion",
      message: "Choose a low-sodium dinner tonight because your sodium intake is high.",
    });
  });

  it("uses the AI JSON suggestion from the suggestion endpoint path", async () => {
    const { service, chat, userReferenceService } = createService(
      jest.fn().mockResolvedValue('{"title":"Plan dinner","message":"Choose a low-sodium dinner and drink water with it."}'),
    );

    const result = await service.getTodaySuggestion(1, "2026-05-22");

    expect(chat).toHaveBeenCalledTimes(1);
    expect(userReferenceService.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "dashboard_suggestion" }),
    );
    const messages = chat.mock.calls[0][0];
    expect(messages[1].content).toContain("Retrieved reference snippets");
    expect(messages[1].content).toContain("Lower sodium meals");
    expect(result).toEqual({
      title: "Plan dinner",
      message: "Choose a low-sodium dinner and drink water with it.",
    });
  });

  it("getTodaySuggestion builds context from UserContextService", async () => {
    const { service, userContext, userContextService, dashboardAiService } = createService(
      jest.fn().mockResolvedValue('{"title":"Plan dinner","message":"Choose a low-sodium dinner."}'),
    );
    const buildSpy = jest.spyOn(dashboardAiService, "buildAiSuggestion");

    await service.getTodaySuggestion(1, "2026-05-22", 420);

    expect(userContextService.assembleRecipeGenerationContext).toHaveBeenCalledWith(1, "2026-05-22", "breakfast", 420);
    expect(buildSpy.mock.calls[0][0].userContext).toBe(userContext);
  });

  it("sends the coach the shared user block (age) and dashboard data, no name or alert bookkeeping", async () => {
    const { service, chat } = createService(
      jest.fn().mockResolvedValue('{"title":"Plan dinner","message":"Choose a low-sodium dinner."}'),
    );

    await service.getTodaySuggestion(1, "2026-05-22");

    const prompt = chat.mock.calls[0][0][1].content;
    expect(prompt).toContain('"age":34');
    expect(prompt).toContain('"nutrient":"sodium"');
    expect(prompt).not.toContain("Alex");
    expect(prompt).not.toContain("isRead");
    expect(prompt).not.toContain("score:");
    expect(prompt).toContain("[1] Lower sodium meals (source: nutrition-guideline)");
  });

  it("falls back to rule-based suggestion when the LLM fails", async () => {
    const { service } = createService(jest.fn().mockRejectedValue(new Error("LLM unavailable")));

    const result = await service.getTodaySuggestion(1, "2026-05-22");

    expect(result).toEqual({
      title: "Dinner suggestion",
      message: "Choose a low-sodium dinner tonight because your sodium intake is high.",
    });
  });

  it("falls back to rule-based suggestion when the LLM returns invalid JSON", async () => {
    const { service } = createService(jest.fn().mockResolvedValue("Try a salad today."));

    const result = await service.getTodaySuggestion(1, "2026-05-22");

    expect(result).toEqual({
      title: "Dinner suggestion",
      message: "Choose a low-sodium dinner tonight because your sodium intake is high.",
    });
  });

  it("normalizes and trims long AI suggestion text", async () => {
    const { service } = createService(
      jest.fn().mockResolvedValue(
        JSON.stringify({
          title: "A very long dashboard nutrition suggestion title",
          message:
            "Choose a simple low-sodium dinner with lean protein, vegetables, and water, then keep the next snack light so today stays balanced and manageable for your nutrition goals.",
        }),
      ),
    );

    const result = await service.getTodaySuggestion(1, "2026-05-22");

    expect(result.title.length).toBeLessThanOrEqual(40);
    expect(result.message.length).toBeLessThanOrEqual(180);
  });
});
