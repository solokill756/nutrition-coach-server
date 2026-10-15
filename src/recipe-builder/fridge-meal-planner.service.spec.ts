import { BadRequestException } from "@nestjs/common";
import { FridgeMealPlannerService } from "./fridge-meal-planner.service";
import { heuristicAllocateWithExclude, pickFoodsForSlotWithExclude } from "./fridge-staple-allocation";

function createService() {
  const recipeBuilderService: any = {
    getRecipeById: jest.fn().mockResolvedValue({ nutritionPerServing: { calories: 200 } }),
    findGeneratedRecipe: jest.fn().mockResolvedValue(null),
    softDeleteGeneratedRecipeSlot: jest.fn().mockResolvedValue(undefined),
    generateRecipe: jest.fn().mockResolvedValue({
      recipe: { nutritionPerServing: { calories: 300, protein: 20, carbs: 30, fat: 10 } },
      recommendation: "Light lunch with pantry staples.",
      safetyWarnings: ["Caution: Recipe sodium (400mg) exceeds your limit of 230mg."],
      generationWarnings: ["Portions adjusted to fit remaining calories."],
      budgetStatus: "ok",
    }),
    createGeneratedRecipe: jest.fn().mockResolvedValue({
      id: 1,
      recommendation: "Light lunch with pantry staples.",
      safetyWarnings: ["Caution: Recipe sodium (400mg) exceeds your limit of 230mg."],
      generationWarnings: ["Portions adjusted to fit remaining calories."],
    }),
  };
  const stapleFoodService: any = {
    listWithFood: jest.fn().mockResolvedValue([
      { id: 1, calories: 100, protein: 10, carbs: 5, fat: 2, fiber: 1 },
      { id: 2, calories: 200, protein: 5, carbs: 20, fat: 4, fiber: 3 },
      { id: 3, calories: 150, protein: 8, carbs: 8, fat: 7, fiber: 2 },
    ]),
  };
  const userContextService: any = {
    assembleRecipeGenerationContext: jest.fn().mockResolvedValue({
      dailyTargetCalories: 2000,
      remaining: { calories: 1800 },
      todayIntake: { totalCalories: 400 },
      thresholds: [],
      profile: { dietType: null, allergies: [] },
      healthDetailed: [],
      conditionRelatedThresholds: [],
    }),
  };
  const stapleAllocationService: any = {
    allocateStaplesForPlan: jest.fn(async ({ staples, generatingSlots }: any) => ({
      allocations: heuristicAllocateWithExclude(staples, generatingSlots),
      source: "heuristic",
    })),
  };
  const config: any = { get: jest.fn(() => undefined) };
  const userRepo: any = { find: jest.fn().mockResolvedValue([]) };
  const logFoodRepo: any = { find: jest.fn().mockResolvedValue([]) };
  const recipeRepo: any = { find: jest.fn().mockResolvedValue([]) };

  const service = new FridgeMealPlannerService(
    recipeBuilderService,
    stapleFoodService,
    userContextService,
    config,
    userRepo,
    logFoodRepo,
    recipeRepo,
    stapleAllocationService,
  );

  return {
    service,
    stapleFoodService,
    recipeBuilderService,
    stapleAllocationService,
    userRepo,
    config,
    logFoodRepo,
    recipeRepo,
  };
}

describe("FridgeMealPlannerService", () => {
  it("generateDailyPlan throws when staples < 2", async () => {
    const { service, stapleFoodService } = createService();
    stapleFoodService.listWithFood.mockResolvedValueOnce([{ id: 1 }]);
    await expect(service.generateDailyPlan(1, "2026-05-31")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("generateDailyPlan returns slots", async () => {
    const { service, stapleAllocationService } = createService();
    const out = await service.generateDailyPlan(1, "2026-05-31");
    expect(out.slots.length).toBe(4);
    expect(stapleAllocationService.allocateStaplesForPlan).toHaveBeenCalledTimes(1);
    const created = out.slots.find((slot) => slot.status === "created");
    expect(created?.recommendation).toBe("Light lunch with pantry staples.");
    expect(created?.safetyWarnings.length).toBeGreaterThan(0);
    expect(created?.generationWarnings.length).toBeGreaterThan(0);
  });

  it("regenerateSlot skips when already logged", async () => {
    const { service, logFoodRepo } = createService();
    logFoodRepo.find.mockResolvedValueOnce([{ mealType: "breakfast" }]);
    const out = await service.regenerateSlot(1, "2026-05-31", "breakfast");
    expect(out.status).toBe("skipped");
  });

  it("handleDailyCron respects disable flag", async () => {
    const { service, config, userRepo } = createService();
    config.get.mockImplementation((k: string) => (k === "FRIDGE_PLAN_CRON_ENABLED" ? "false" : undefined));
    await service.handleDailyCron();
    expect(userRepo.find).not.toHaveBeenCalled();
  });

  it("parsers and staple pickers behave", () => {
    const { service } = createService();
    expect((service as any).safeParse("{\"a\":1}")).toEqual({ a: 1 });
    expect((service as any).safeParse("bad")).toEqual({});
    const selected = pickFoodsForSlotWithExclude(
      [
        { id: 1, calories: 100, protein: 1, carbs: 10, fiber: 1 },
        { id: 2, calories: 120, protein: 5, carbs: 6, fiber: 2 },
      ] as any[],
      "snack",
      new Set(),
    );
    expect(selected.length).toBeGreaterThan(0);
  });
});

describe("generation in-flight lock (node-cache)", () => {
  it("getManualQuota returns inProgress false when lock not held", () => {
    const { service } = createService();
    expect(service.getManualQuota(1)).toEqual({ inProgress: false });
  });

  it("getManualQuota returns inProgress true when lock held", () => {
    const { service } = createService();
    (service as any).acquireGenerationLock(1, "2026-06-17");
    expect(service.getManualQuota(1)).toEqual({ inProgress: true });
  });

  it("generateManualPlan throws 409 when lock already held", async () => {
    const { service } = createService();
    (service as any).acquireGenerationLock(1, "2026-06-17");
    await expect(service.generateManualPlan(1, "2026-06-17", {})).rejects.toMatchObject({
      status: 409,
      response: { errorKey: "fridgePlan.errors.generationInProgress" },
    });
  });

  it("generateManualPlan releases lock after success", async () => {
    const { service } = createService();
    await service.generateManualPlan(1, "2026-06-17", {});
    expect(service.getManualQuota(1)).toEqual({ inProgress: false });
  });

  it("generateManualPlan releases lock when generation fails", async () => {
    const { service, stapleFoodService } = createService();
    stapleFoodService.listWithFood.mockResolvedValueOnce([{ id: 1 }]);
    await expect(service.generateManualPlan(1, "2026-06-17", {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.getManualQuota(1)).toEqual({ inProgress: false });
  });

  it("second generateManualPlan succeeds after first completes", async () => {
    const { service } = createService();
    await service.generateManualPlan(1, "2026-06-17", {});
    await service.generateManualPlan(1, "2026-06-17", {});
    expect(service.getManualQuota(1)).toEqual({ inProgress: false });
  });

  it("regenerateSlot throws 409 when lock held", async () => {
    const { service } = createService();
    (service as any).acquireGenerationLock(1, "2026-06-17");
    await expect(
      service.regenerateSlot(1, "2026-06-17", "breakfast"),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorKey: "fridgePlan.errors.generationInProgress" },
    });
  });
});

describe("FridgeMealPlannerService slot allocation and regeneration", () => {
  it("builds a daily fridge plan with breakfast lunch dinner and snack slots", async () => {
    const { service } = createService();
    const out = await service.generateDailyPlan(1, "2026-06-11");

    expect(out.slots).toHaveLength(4);
    const slotKeys = out.slots.map((s) => s.mealSlot);
    expect(slotKeys).toEqual(expect.arrayContaining(["breakfast", "lunch", "dinner", "snack"]));
  });

  it("uses meal calorie allocation ratios for each slot (breakfast 25%, lunch 35%, snack 10%, dinner 30%)", () => {
    const { service } = createService();
    const ctx: any = {
      dailyTargetCalories: 2000,
      remaining: { calories: 2000 },
      todayIntake: { totalCalories: 0 },
      thresholds: [],
    };
    const slots = ["breakfast", "lunch", "snack", "dinner"] as any[];
    const targets = (service as any).targetsForSlots(ctx, slots, 2000) as Map<string, { calories: number }>;

    expect(targets.get("breakfast")!.calories).toBe(500);  // 25%
    expect(targets.get("lunch")!.calories).toBe(700);      // 35%
    expect(targets.get("snack")!.calories).toBe(200);      // 10%
    expect(targets.get("dinner")!.calories).toBe(600);     // 30%
  });

  it("splits the plan by the user's meal split and skips 0% meals", () => {
    const { service } = createService();
    const ctx: any = {
      dailyTargetCalories: 2000,
      thresholds: [],
      remaining: { calories: 1500 },
      todayIntake: { totalCalories: 500 },
      mealSplits: { breakfast: 0.2, lunch: 0.4, dinner: 0.4, snack: 0 },
    };
    const targets = (service as any).targetsForSlots(ctx, ["breakfast", "lunch", "snack"], 1500);
    expect(targets.get("breakfast").calories).toBe(500);
    expect(targets.get("lunch").calories).toBe(1000);
    expect(targets.has("snack")).toBe(false);
  });

  it("falls back to the default split when every chosen meal is 0%", () => {
    const { service } = createService();
    const ctx: any = {
      dailyTargetCalories: 2000,
      thresholds: [],
      remaining: { calories: 300 },
      todayIntake: { totalCalories: 1700 },
      mealSplits: { breakfast: 0.3, lunch: 0.4, dinner: 0.3, snack: 0 },
    };
    const targets = (service as any).targetsForSlots(ctx, ["snack"], 300);
    expect(targets.get("snack").calories).toBe(300);
  });

  it("regenerates one meal slot without replacing the whole plan (returns single slot result)", async () => {
    const { service, recipeBuilderService } = createService();
    // Not logged, so will generate
    const out = await service.regenerateSlot(1, "2026-06-11", "lunch");
    // Result is a single slot object
    expect(out).toHaveProperty("mealSlot", "lunch");
    expect(out).toHaveProperty("status");
    // generateRecipe (via recipeBuilderService) was called exactly for lunch slot
    expect(recipeBuilderService.generateRecipe).toHaveBeenCalledTimes(1);
  });
});

describe("FoodSemanticSearchService edge cases", () => {
  it("returns empty array when no semantic match is found", async () => {
    const { DataSource } = require("typeorm");
    const { ConfigService } = require("@nestjs/config");
    const { VectorService } = require("../retrieval/vector.service");
    const { FoodSemanticSearchService } = require("./food-semantic-search.service");

    const emptyQuery = jest.fn().mockResolvedValue([]);
    const ds = { query: emptyQuery } as any;
    const config = {
      get: jest.fn((k: string) => {
        if (k === "POSTGRES_SCHEMA") return "public";
        if (k === "POSTGRES_VECTOR_DIM") return "768";
      }),
    } as any;
    const vector = { getQueryEmbedding: jest.fn().mockResolvedValue([0.1]) } as any;
    const svc = new FoodSemanticSearchService(ds, config, vector);

    const result = await svc.searchIngredient("unknown_xyz_ingredient", 5);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});
