import type { RecipeGenerationContext } from "../nutrition/user-context.service";
import { FridgeStapleAllocationService } from "./fridge-staple-allocation.service";
import {
  heuristicAllocateWithExclude,
  pickFoodsForSlotWithExclude,
  validateAllocations,
} from "./fridge-staple-allocation";
import type { RecipeMealSlot } from "./dto/recipe.dto";
import { buildLlmUserProfile, formatLlmUserBlock } from "../nutrition/llm-user-profile";
import { sampleRecipeContext } from "../nutrition/__fixtures__/llm-context.fixture";
import { ALLOCATION_PROMPTS } from "./constants/allocation-prompts";

const staples = [
  { id: 1, foodName: "Egg", calories: 155, protein: 13, carbs: 1, fat: 11, sodium: 140, fiber: 0, servingSize: 100, servingUnit: "g" },
  { id: 2, foodName: "Oats", calories: 389, protein: 5, carbs: 66, fat: 7, sodium: 0, fiber: 10, servingSize: 100, servingUnit: "g" },
  { id: 3, foodName: "Chicken", calories: 165, protein: 31, carbs: 0, fat: 4, sodium: 74, fiber: 0, servingSize: 100, servingUnit: "g" },
  { id: 4, foodName: "Brown rice", calories: 111, protein: 3, carbs: 23, fat: 1, sodium: 5, fiber: 2, servingSize: 100, servingUnit: "g" },
  { id: 5, foodName: "Banana", calories: 105, protein: 1, carbs: 27, fat: 0, sodium: 1, fiber: 3, servingSize: 100, servingUnit: "g" },
  { id: 6, foodName: "Frankfurter", calories: 290, protein: 10, carbs: 2, fat: 26, sodium: 800, fiber: 0, servingSize: 100, servingUnit: "g" },
] as any[];

function minimalCtx(): RecipeGenerationContext {
  return {
    userId: 1,
    dateKey: "2026-06-23",
    mealSlot: "breakfast",
    recentLogHistoryDays: 3,
    profile: { age: 30, sex: "male", weight: 70, goalWeight: 68, height: 175, dietType: null, allergies: [], fitnessLevel: "moderate" },
    goalsDetailed: [],
    healthDetailed: [],
    thresholds: [],
    conditionRelatedThresholds: [],
    recentHistory: [],
    recentRecipeLogs: [],
    todayIntake: {
      totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0,
      totalSodium: 0, totalSugar: 0, totalSaturatedFat: 0, totalCholesterol: 0, totalPotassium: 0,
    },
    dailyTargetCalories: 2000,
    remaining: {
      calories: 2000, sodiumMg: null, carbsG: null, proteinG: null, fatG: null,
      sugarG: null, saturatedFatG: null, cholesterolMg: null, potassiumMgMinRemaining: null,
    },
  };
}

describe("validateAllocations", () => {
  it("accepts valid 2-4 ids per slot", () => {
    const result = validateAllocations({
      allocations: { breakfast: [1, 2], lunch: [3, 4], snack: [5, 6], dinner: [4, 3] },
      generatingSlots: ["breakfast", "lunch", "snack", "dinner"],
      stapleIds: new Set(staples.map((f) => f.id)),
      stapleCount: 6,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unknown food id", () => {
    const result = validateAllocations({
      allocations: { breakfast: [1, 99] },
      generatingSlots: ["breakfast"],
      stapleIds: new Set([1, 2, 3]),
      stapleCount: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_food_id");
  });

  it("rejects excessive duplication when pantry is large enough", () => {
    const slots: RecipeMealSlot[] = ["breakfast", "lunch", "snack"];
    const result = validateAllocations({
      allocations: {
        breakfast: [3, 2],
        lunch: [3, 4],
        snack: [3, 5],
      },
      generatingSlots: slots,
      stapleIds: new Set(staples.map((f) => f.id)),
      stapleCount: 6,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("excessive_duplication");
  });

  it("allows reuse when pantry is small", () => {
    const small = staples.slice(0, 3);
    const result = validateAllocations({
      allocations: { breakfast: [1, 2], lunch: [2, 3], snack: [1, 3], dinner: [2, 1] },
      generatingSlots: ["breakfast", "lunch", "snack", "dinner"],
      stapleIds: new Set(small.map((f) => f.id)),
      stapleCount: 3,
    });
    expect(result.ok).toBe(true);
  });
});

describe("heuristicAllocateWithExclude", () => {
  it("returns 2-4 ids per slot", () => {
    const slots: RecipeMealSlot[] = ["breakfast", "lunch", "snack", "dinner"];
    const c1 = heuristicAllocateWithExclude(staples, slots);
    expect(c1.breakfast?.length).toBeGreaterThanOrEqual(2);
    expect(c1.snack?.length).toBe(2);
  });

  it("produces at least as many unique ids as independent top-macro picks", () => {
    const slots: RecipeMealSlot[] = ["breakfast", "lunch", "snack", "dinner"];
    const c1 = heuristicAllocateWithExclude(staples, slots);
    const independent = slots.flatMap((slot) =>
      pickFoodsForSlotWithExclude(staples, slot, new Set()).map((f) => f.id),
    );
    const c1Unique = new Set(Object.values(c1).flat()).size;
    const indepUnique = new Set(independent).size;
    expect(c1Unique).toBeGreaterThanOrEqual(indepUnique);
  });
});

describe("FridgeStapleAllocationService", () => {
  it("uses AI allocations when valid", async () => {
    const ollama = {
      chat: jest.fn().mockResolvedValue(JSON.stringify({
        allocations: { breakfast: [1, 2], lunch: [3, 4] },
      })),
    };
    const service = new FridgeStapleAllocationService(ollama as any);
    const out = await service.allocateStaplesForPlan({
      staples: staples.slice(0, 4) as any[],
      generatingSlots: ["breakfast", "lunch"],
      ctx: minimalCtx(),
      slotTargets: new Map([
        ["breakfast", { calories: 500, protein: 25, carbs: 60, fat: 15 }],
        ["lunch", { calories: 700, protein: 35, carbs: 80, fat: 20 }],
      ]),
      references: { text: "None.", used: [] },
    });
    expect(out.source).toBe("ai");
    expect(out.allocations.breakfast).toEqual([1, 2]);
    expect(ollama.chat).toHaveBeenCalledTimes(1);
  });

  it("falls back to C1 when AI returns invalid json", async () => {
    const ollama = { chat: jest.fn().mockResolvedValue("not json") };
    const service = new FridgeStapleAllocationService(ollama as any);
    const out = await service.allocateStaplesForPlan({
      staples: staples as any[],
      generatingSlots: ["breakfast", "lunch"],
      ctx: minimalCtx(),
      slotTargets: new Map([
        ["breakfast", { calories: 500, protein: 25, carbs: 60, fat: 15 }],
        ["lunch", { calories: 700, protein: 35, carbs: 80, fat: 20 }],
      ]),
      references: { text: "None.", used: [] },
    });
    expect(out.source).toBe("heuristic");
    expect(out.allocations.breakfast?.length).toBeGreaterThanOrEqual(2);
    expect(out.allocations.lunch?.length).toBeGreaterThanOrEqual(2);
  });

  describe("prompt content", () => {
    async function capture(referencesText = "None.") {
      const ollama = {
        chat: jest.fn().mockResolvedValue(JSON.stringify({ allocations: { breakfast: [1, 2] } })),
      };
      const service = new FridgeStapleAllocationService(ollama as any);
      const ctx = sampleRecipeContext();
      await service.allocateStaplesForPlan({
        staples: staples.slice(0, 4) as any[],
        generatingSlots: ["breakfast"],
        ctx,
        slotTargets: new Map([["breakfast", { calories: 500, protein: 25, carbs: 60, fat: 15 }]]),
        references: { text: referencesText, used: [] },
      });
      const messages = ollama.chat.mock.calls[0][0] as { role: string; content: string }[];
      return {
        ctx,
        system: messages.find((m) => m.role === "system")!.content,
        user: messages.find((m) => m.role === "user")!.content,
      };
    }

    it("allocation prompt has the shared user block", async () => {
      const { ctx, user } = await capture();
      expect(user).toContain(formatLlmUserBlock(buildLlmUserProfile(ctx)));
    });

    it("allocation prompt has references", async () => {
      const { user } = await capture("[1] Low sodium");
      expect(user).toContain("[1] Low sodium");
    });

    it("allocation input is compact", async () => {
      const { user } = await capture();
      const after = user.split("Allocation input (JSON):\n")[1];
      expect(after).not.toContain("\n  ");
    });

    it("system prompt mentions references", async () => {
      const { system } = await capture();
      expect(system).toContain("Reference");
      expect(system).toBe(ALLOCATION_PROMPTS.SYSTEM);
    });
  });
});
