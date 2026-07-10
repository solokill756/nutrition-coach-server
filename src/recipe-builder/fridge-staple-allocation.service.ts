import { Injectable, Logger } from "@nestjs/common";
import { OllamaService } from "../ollama/ollama.service";
import type { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import type { RecipeGenerationContext } from "../nutrition/user-context.service";
import type { RecipeMealSlot } from "./dto/recipe.dto";
import type { MealNutritionTarget } from "./recipe-nutrition-scoring";
import {
  heuristicAllocateWithExclude,
  parseAllocationJson,
  validateAllocations,
  type StapleAllocationMap,
} from "./fridge-staple-allocation";
import { ALLOCATION_PROMPTS } from "./constants/allocation-prompts";

const ALLOCATION_SYSTEM_PROMPT = ALLOCATION_PROMPTS.SYSTEM;

export type AllocateStaplesParams = {
  staples: FoodNutritionEntity[];
  generatingSlots: RecipeMealSlot[];
  ctx: RecipeGenerationContext;
  slotTargets: Map<RecipeMealSlot, MealNutritionTarget>;
  alreadyAllocated?: StapleAllocationMap;
  regenerateSlot?: RecipeMealSlot;
};

export type AllocateStaplesResult = {
  allocations: StapleAllocationMap;
  source: "ai" | "heuristic";
  fallbackReason?: string;
};

@Injectable()
export class FridgeStapleAllocationService {
  private readonly logger = new Logger(FridgeStapleAllocationService.name);

  constructor(private readonly ollamaService: OllamaService) {}

  buildAllocationInput(params: AllocateStaplesParams) {
    const { staples, generatingSlots, ctx, slotTargets, alreadyAllocated, regenerateSlot } = params;
    const slotTargetsObj: Partial<Record<RecipeMealSlot, MealNutritionTarget>> = {};
    for (const slot of generatingSlots) {
      const t = slotTargets.get(slot);
      if (t) slotTargetsObj[slot] = t;
    }
    return {
      stapleCount: staples.length,
      generatingSlots,
      minUniqueFoodIdsPreferred: Math.min(generatingSlots.length * 2, staples.length),
      staples: staples.map((f) => ({
        foodId: Number(f.id),
        foodName: f.foodName,
        caloriesPerServing: Number(f.calories ?? 0),
        proteinG: Number(f.protein ?? 0),
        carbsG: Number(f.carbs ?? 0),
        fatG: Number(f.fat ?? 0),
        sodiumMg: Number(f.sodium ?? 0),
        fiberG: Number(f.fiber ?? 0),
      })),
      slotTargets: slotTargetsObj,
      profile: { dietType: ctx.profile.dietType, allergies: ctx.profile.allergies ?? [] },
      healthDetailed: ctx.healthDetailed,
      conditionRelatedThresholds: ctx.conditionRelatedThresholds,
      todayIntake: ctx.todayIntake,
      remainingToday: ctx.remaining,
      ...(alreadyAllocated ? { alreadyAllocated } : {}),
      ...(regenerateSlot ? { regenerateSlot } : {}),
    };
  }

  async allocateStaplesForPlan(params: AllocateStaplesParams): Promise<AllocateStaplesResult> {
    const { staples, generatingSlots } = params;
    if (generatingSlots.length === 0) {
      return { allocations: {}, source: "heuristic" };
    }

    const stapleIds = new Set(staples.map((f) => Number(f.id)));
    const initialUsed = new Set(
      Object.values(params.alreadyAllocated ?? {})
        .flat()
        .map((id) => Number(id)),
    );

    try {
      const input = this.buildAllocationInput(params);
      const raw = await this.ollamaService.chat([
        { role: "system", content: ALLOCATION_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(input, null, 2) },
      ]);
      const allocations = parseAllocationJson(raw);
      if (!allocations) {
        return this.heuristicFallback(staples, generatingSlots, initialUsed, "invalid_json");
      }
      const validation = validateAllocations({
        allocations,
        generatingSlots,
        stapleIds,
        stapleCount: staples.length,
      });
      if (!validation.ok) {
        return this.heuristicFallback(staples, generatingSlots, initialUsed, validation.reason);
      }
      this.logger.debug(`Staple allocation AI ok slots=${generatingSlots.join(",")}`);
      return { allocations, source: "ai" };
    } catch (error) {
      const message = (error as Error).message ?? "ai_error";
      return this.heuristicFallback(staples, generatingSlots, initialUsed, message);
    }
  }

  private heuristicFallback(
    staples: FoodNutritionEntity[],
    generatingSlots: RecipeMealSlot[],
    initialUsed: Set<number>,
    reason: string,
  ): AllocateStaplesResult {
    this.logger.warn(`Staple allocation fallback reason=${reason}`);
    return {
      allocations: heuristicAllocateWithExclude(staples, generatingSlots, initialUsed),
      source: "heuristic",
      fallbackReason: reason,
    };
  }
}
