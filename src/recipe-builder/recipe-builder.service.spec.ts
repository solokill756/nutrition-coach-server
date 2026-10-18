import { BadGatewayException, NotFoundException } from "@nestjs/common";
import { RECIPE_COMMUNITY_ACCESS_WHERE, RecipeBuilderService } from "./recipe-builder.service";

function createService() {
  const retrievalService: any = {
    retrieve: jest.fn().mockResolvedValue([]),
  };
  const ollamaService: any = { chat: jest.fn() };
  const config: any = { get: jest.fn((k: string) => (k === "TOP_K" ? 8 : undefined)) };
  const userContextService: any = { assembleRecipeGenerationContext: jest.fn() };
  const stapleFoodService: any = { listWithFood: jest.fn().mockResolvedValue([]) };
  const foodService: any = { searchFood: jest.fn().mockResolvedValue(null) };
  const mealsService: any = {
    create: jest.fn().mockResolvedValue({ id: 123 }),
    addItem: jest.fn().mockResolvedValue(undefined),
    getById: jest.fn().mockResolvedValue({ id: 123 }),
  };

  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    getOne: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
  };

  const recipeRepo: any = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    save: jest.fn(async (x) => ({ id: x.id ?? 1, ...x })),
    create: jest.fn((x) => x),
    createQueryBuilder: jest.fn(() => qb),
  };
  const recipeIngredientRepo: any = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue([]),
    create: jest.fn((x) => x),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const recipeStepRepo: any = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue([]),
    create: jest.fn((x) => x),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const foodRepo: any = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };

  const service = new RecipeBuilderService(
    retrievalService,
    ollamaService,
    config,
    userContextService,
    stapleFoodService,
    foodService,
    mealsService,
    recipeRepo,
    recipeIngredientRepo,
    recipeStepRepo,
    foodRepo,
  );
  return {
    service,
    retrievalService,
    ollamaService,
    userContextService,
    stapleFoodService,
    recipeRepo,
    recipeIngredientRepo,
    recipeStepRepo,
    foodRepo,
    mealsService,
    qb,
  };
}

function makeRecipeCtx(overrides: any = {}) {
  return {
    userId: 1,
    dateKey: "2026-06-23",
    mealSlot: "lunch",
    recentLogHistoryDays: 7,
    profile: {},
    goalsDetailed: [],
    healthDetailed: [],
    thresholds: [],
    conditionRelatedThresholds: [],
    recentHistory: [],
    recentRecipeLogs: [],
    todayIntake: {
      totalCalories: 0,
      totalProtein: 0,
      totalCarbs: 0,
      totalFat: 0,
      totalSodium: 0,
      totalSugar: 0,
      totalSaturatedFat: 0,
      totalCholesterol: 0,
      totalPotassium: 0,
      totalFiber: 0,
      totalPhosphorus: 0,
    },
    dailyTargetCalories: 2000,
    remaining: {
      calories: 2000,
      sodiumMg: 2000,
      carbsG: 250,
      proteinG: 120,
      fatG: 60,
      sugarG: 40,
      saturatedFatG: 20,
      cholesterolMg: 300,
      potassiumMgMinRemaining: 0,
      fiberGMinRemaining: null,
      phosphorusMg: null,
    },
    ...overrides,
  };
}

describe("RecipeBuilderService", () => {
  it("parseRecipeAiResponse throws for invalid json", () => {
    const { service } = createService();
    expect(() => (service as any).parseRecipeAiResponse("xxx")).toThrow(BadGatewayException);
  });

  it("parseRecipeAiResponse turns the model's written times into whole minutes", () => {
    const { service } = createService();
    const { recipe } = (service as any).parseRecipeAiResponse(
      JSON.stringify({
        recipe: {
          name: "Apple porridge",
          preparationTime: "10 minutes",
          cookingTime: "1 hour",
          steps: [
            { order: 1, instruction: "Dice.", duration: "2 minutes" },
            { order: 2, instruction: "Simmer.", duration: 5 },
            { order: 3, instruction: "Serve.", duration: "until thick" },
          ],
        },
      }),
    );
    expect(recipe.preparationTime).toBe(10);
    expect(recipe.cookingTime).toBe(60);
    expect(recipe.steps.map((s: { duration?: number }) => s.duration)).toEqual([2, 5, undefined]);
  });

  it("parseRecipeAiResponse defaults unreadable recipe times to 0", () => {
    const { service } = createService();
    const { recipe } = (service as any).parseRecipeAiResponse(
      JSON.stringify({ recipe: { name: "X", preparationTime: "quick", steps: "none" } }),
    );
    expect(recipe.preparationTime).toBe(0);
    expect(recipe.cookingTime).toBe(0);
    expect(recipe.steps).toEqual([]);
  });

  it("safeParse returns object or empty", () => {
    const { service } = createService();
    expect((service as any).safeParse("{\"a\":1}")).toEqual({ a: 1 });
    expect((service as any).safeParse("bad")).toEqual({});
  });

  it("toCreateRecipeDto normalizes values", () => {
    const { service } = createService();
    const dto = (service as any).toCreateRecipeDto({
      name: "  My Recipe ",
      description: " d ",
      servings: 2,
      preparationTime: 10,
      cookingTime: 20,
      difficulty: "invalid",
      ingredients: [{ name: "egg", amount: 1, unit: "piece" }],
      steps: [{ order: 0, instruction: "", duration: -2 }],
      nutritionPerServing: {},
    });
    expect(dto.name).toBe("My Recipe");
    expect(dto.difficulty).toBe("easy");
    expect(dto.steps[0].order).toBe(1);
  });

  it("sanitizeStapleIngredients keeps only allowed staples", () => {
    const { service } = createService();
    const recipe: any = { ingredients: [{ name: "Egg", foodId: 1 }, { name: "X", foodId: 99 }] };
    (service as any).sanitizeStapleIngredients(
      recipe,
      new Set([1]),
      [{ id: 1, foodName: "Egg" }],
    );
    expect(recipe.ingredients).toHaveLength(1);
    expect(recipe.ingredients[0].foodId).toBe(1);
  });

  it("applyCatalogUnitsToIngredients fills amount/unit/amount_g", () => {
    const { service } = createService();
    const recipe: any = { ingredients: [{ foodId: 2, amount: 1 }] };
    (service as any).applyCatalogUnitsToIngredients(recipe, [
      { id: 2, servingSize: 100, servingUnit: "g" },
    ]);
    expect(recipe.ingredients[0].unit).toBe("100 g");
    expect(recipe.ingredients[0].amount_g).toBe(100);
  });

  it("clampRecipeToRemainingBudgets adjusts ingredients", () => {
    const { service } = createService();
    const recipe: any = {
      ingredients: [{ amount_g: 100, amount: 1 }],
      nutritionPerServing: { calories: 500, sodium: 1000, carbs: 50, protein: 30, fat: 20, saturatedFat: 8, cholesterol: 300 },
    };
    const warnings: string[] = [];
    const status = (service as any).clampRecipeToRemainingBudgets(recipe, { calories: 200, sodiumMg: 300 }, warnings);
    expect(status).toBe("adjusted");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("verifyBudget returns warning when still over cap", () => {
    const { service } = createService();
    const status = (service as any).verifyBudget(
      { nutritionPerServing: { calories: 300 } },
      { calories: 100 },
      [],
    );
    expect(status).toBe("warning");
  });

  it("validateNutritionAgainstThresholds emits warnings", () => {
    const { service } = createService();
    const warnings = (service as any).validateNutritionAgainstThresholds(
      { nutritionPerServing: { sodium: 5000, carbs: 200, calories: 1000, saturatedFat: 30, cholesterol: 400, potassium: 10 } },
      { thresholds: [{ nutrient: "sodium", maxAmount: 2000 }, { nutrient: "potassium", minAmount: 1000 }] },
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("getRecipeById throws not found", async () => {
    const { service, qb } = createService();
    qb.getOne.mockResolvedValueOnce(null);
    await expect(service.getRecipeById(1, 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("createRecipe and update/delete/convert flows", async () => {
    const { service, recipeRepo, recipeIngredientRepo, recipeStepRepo, mealsService, qb } = createService();
    const recipeObj = {
      id: 1,
      userId: 1,
      delFlag: false,
      name: "R",
      servings: 1,
      source: JSON.stringify({}),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    recipeRepo.findOne.mockResolvedValue(recipeObj);
    qb.getOne.mockResolvedValue(recipeObj);

    recipeIngredientRepo.find.mockResolvedValue([
      { position: 1, quantityRaw: JSON.stringify({ name: "egg", quantity: 1, unit: "g", calories: 10 }) },
    ]);
    recipeStepRepo.find.mockResolvedValue([{ stepNo: 1, instruction: "x", durationMinutes: 1, tips: null }]);

    const dto: any = {
      name: "abc",
      servings: 1,
      ingredients: [{ name: "egg", quantity: 1, unit: "g" }],
      steps: [{ order: 1, instruction: "cook" }],
      prepMinutes: 10,
      cookMinutes: 10,
      difficulty: "easy",
    };
    await service.createRecipe(1, dto);
    await service.updateRecipe(1, 1, dto);
    const del = await service.deleteRecipe(1, 1);
    expect(del.statusCode).toBe(200);
    await service.convertToMeal(1, 1);
    expect(mealsService.create).toHaveBeenCalled();
  });

  it("listRecipes and getRecipeById support community sharing", async () => {
    const { service, recipeRepo, qb } = createService();
    
    // Test listing community recipes
    await service.listRecipes(1, undefined, { includeCommunity: true });
    expect(recipeRepo.createQueryBuilder).toHaveBeenCalled();
    expect(qb.where).toHaveBeenCalledWith(
      RECIPE_COMMUNITY_ACCESS_WHERE,
      { userId: 1 }
    );

    // Test getRecipeById allows other users if shared
    const sharedRecipe = {
      id: 5,
      userId: 2, // Different user
      name: "Shared Salad",
      servings: 2,
      source: JSON.stringify({ shareWith: 2 }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    qb.getOne.mockResolvedValueOnce(sharedRecipe);
    const result = await service.getRecipeById(1, 5); // User 1 accesses User 2's recipe
    expect(result.id).toBe(5);
  });
});

describe("RecipeBuilderService AI safeguards", () => {
  it("returns a structured recipe from selected staple foods (title, ingredients, steps)", async () => {
    const { service, ollamaService, userContextService, stapleFoodService, foodRepo } = createService();
    const stapleFood = { id: 10, foodName: "Chicken", calories: 200, protein: 30, carbs: 0, fat: 8, sodium: 70, fiber: 0, servingSize: 100, servingUnit: "g" };
    stapleFoodService.listWithFood.mockResolvedValue([stapleFood]);
    userContextService.assembleRecipeGenerationContext.mockResolvedValue(makeRecipeCtx());
    foodRepo.find.mockResolvedValue([stapleFood]);
    foodRepo.findOne.mockResolvedValue(stapleFood);
    ollamaService.chat.mockResolvedValueOnce(
      JSON.stringify({
        recipe: {
          name: "Chicken Bowl",
          servings: 1,
          ingredients: [{ foodId: 10, amount: 1 }],
          steps: [{ order: 1, instruction: "cook" }],
        },
        recommendation: "",
      }),
    );

    const result = await service.generateRecipe(
      { mealSlot: "lunch", foodIds: [10] } as any,
      1,
    );

    expect(result).toMatchObject({
      recipe: expect.objectContaining({
        name: expect.any(String),
        ingredients: expect.any(Array),
        steps: expect.any(Array),
      }),
    });
  });

  it("recalculates nutrition from food data instead of trusting raw AI placeholder", async () => {
    const { service, ollamaService, userContextService, stapleFoodService, foodRepo } = createService();
    const stapleFood = { id: 10, foodName: "Chicken", calories: 200, protein: 30, carbs: 0, fat: 8, sodium: 70, fiber: 0, servingSize: 100, servingUnit: "g" };
    stapleFoodService.listWithFood.mockResolvedValue([stapleFood]);
    userContextService.assembleRecipeGenerationContext.mockResolvedValue(makeRecipeCtx());
    foodRepo.find.mockResolvedValue([stapleFood]);
    foodRepo.findOne.mockResolvedValue(stapleFood);
    ollamaService.chat.mockResolvedValueOnce(
      JSON.stringify({
        recipe: {
          name: "Chicken Bowl",
          servings: 1,
          ingredients: [{ foodId: 10, amount: 1 }],
          steps: [{ order: 1, instruction: "cook" }],
          nutritionPerServing: { calories: 9999 },
        },
        recommendation: "",
      }),
    );

    const result = await service.generateRecipe(
      { mealSlot: "lunch", foodIds: [10] } as any,
      1,
    );

    expect(JSON.stringify(result.recipe.nutritionPerServing)).not.toContain("9999");
  });

  it("handles missing RAG context without an unhandled crash", async () => {
    const { service, ollamaService, retrievalService, userContextService, stapleFoodService, foodRepo } = createService();
    retrievalService.retrieve.mockResolvedValueOnce([]);
    const stapleFood = { id: 10, foodName: "Egg", calories: 70, protein: 6, carbs: 1, fat: 5, sodium: 60, fiber: 0, servingSize: 50, servingUnit: "g" };
    stapleFoodService.listWithFood.mockResolvedValue([stapleFood]);
    userContextService.assembleRecipeGenerationContext.mockResolvedValue(makeRecipeCtx());
    foodRepo.find.mockResolvedValue([stapleFood]);
    foodRepo.findOne.mockResolvedValue(stapleFood);
    ollamaService.chat.mockResolvedValueOnce(
      JSON.stringify({
        recipe: {
          name: "Simple Egg",
          servings: 1,
          ingredients: [{ foodId: 10, amount: 1 }],
          steps: [{ order: 1, instruction: "boil" }],
        },
        recommendation: "",
      }),
    );

    const result = await service.generateRecipe(
      { mealSlot: "lunch", foodIds: [10] } as any,
      1,
    );

    expect(result).toMatchObject({
      recipe: expect.objectContaining({ name: expect.any(String) }),
    });
    expect(result.evidence).toEqual([]);
  });

  it("returns a numeric nutrition score and target for an authenticated recipe", async () => {
    const { service, ollamaService, userContextService, stapleFoodService, foodRepo } = createService();
    const stapleFood = { id: 10, foodName: "Chicken", calories: 200, protein: 30, carbs: 0, fat: 8, sodium: 70, fiber: 0, servingSize: 100, servingUnit: "g" };
    stapleFoodService.listWithFood.mockResolvedValue([stapleFood]);
    userContextService.assembleRecipeGenerationContext.mockResolvedValue(makeRecipeCtx());
    foodRepo.find.mockResolvedValue([stapleFood]);
    foodRepo.findOne.mockResolvedValue(stapleFood);
    ollamaService.chat.mockResolvedValueOnce(
      JSON.stringify({
        recipe: {
          name: "Chicken Bowl",
          servings: 1,
          ingredients: [{ foodId: 10, amount: 1 }],
          steps: [{ order: 1, instruction: "cook" }],
        },
        recommendation: "",
      }),
    );

    const result = await service.generateRecipe(
      { mealSlot: "lunch", foodIds: [10] } as any,
      1,
    );

    expect(typeof result.score).toBe("number");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.nutritionTarget).toMatchObject({
      calories: expect.any(Number),
      protein: expect.any(Number),
      carbs: expect.any(Number),
      fat: expect.any(Number),
    });
  });
});

describe("RecipeBuilderService meal targets and prompt", () => {
  it("judges potassium against the meal's share of the daily target", () => {
    const { service } = createService();
    const check = (potassium: number) =>
      (service as any).validateNutritionAgainstThresholds(
        { nutritionPerServing: { potassium } },
        { thresholds: [{ nutrient: "potassium", minAmount: 4700 }] },
        "dinner",
      );
    // Dinner is 30% of the day: about 1,410 mg of 4,700 mg.
    expect(check(1728)).toEqual([]);
    expect(check(900)).toEqual([
      "Potassium is low for this dinner: 900 mg vs about 1,410 mg (30% of your 4,700 mg daily target).",
    ]);
  });

  it("tells the AI this meal's targets and sends a lean prompt", async () => {
    const { service, ollamaService, userContextService, stapleFoodService, foodRepo } = createService();
    const stapleFood = { id: 10, foodName: "Chicken", calories: 200, protein: 30, carbs: 0, fat: 8, sodium: 70, fiber: 0, servingSize: 100, servingUnit: "g" };
    stapleFoodService.listWithFood.mockResolvedValue([stapleFood]);
    userContextService.assembleRecipeGenerationContext.mockResolvedValue(
      makeRecipeCtx({
        todayIntake: { ...makeRecipeCtx().todayIntake, totalCalories: 1200 },
        remaining: { ...makeRecipeCtx().remaining, calories: 800 },
      }),
    );
    foodRepo.find.mockResolvedValue([stapleFood]);
    foodRepo.findOne.mockResolvedValue(stapleFood);
    ollamaService.chat.mockResolvedValueOnce(
      JSON.stringify({
        recipe: { name: "Chicken Bowl", servings: 1, ingredients: [{ foodId: 10, amount: 1 }], steps: [{ order: 1, instruction: "cook" }] },
        recommendation: "",
      }),
    );

    await service.generateRecipe({ mealSlot: "dinner", foodIds: [10] } as any, 1);

    const [system, user] = ollamaService.chat.mock.calls.at(-1)[0] as { content: string }[];
    const prompt = `${system.content}\n${user.content}`;
    // 2000 kcal/day, dinner 30%: 600 kcal, 38 g protein, 75 g carbs, 17 g fat.
    expect(user.content).toContain(
      "Aim for ONE serving of this dinner at about 600 kcal, 38 g protein, 75 g carbs, 17 g fat (stay within ±15%).",
    );
    // 800 kcal left today must not shrink dinner to 800 × 30% = 240.
    expect(user.content).toContain("Hard max kcal for ONE serving of this meal slot: ~600 kcal.");
    expect(user.content).toContain("Protein left today (a ceiling, not a target): ~120 g.");
    expect(user.content).not.toContain("Max protein (g) per serving");
    expect(prompt).not.toContain("food_id");
    expect(prompt).not.toContain("catalogUnitLabel");
    expect(prompt.match(/catalog reference portions/g)).toHaveLength(1);
    // JSON blocks are compact, not indented.
    expect(user.content).not.toMatch(/\n {2}"/);
  });

  it("judges potassium against the user's own share for the meal", () => {
    const { service } = createService();
    const warnings = (service as any).validateNutritionAgainstThresholds(
      { nutritionPerServing: { potassium: 1500 } },
      { thresholds: [{ nutrient: "potassium", minAmount: 4700 }] },
      "dinner",
      0.4,
    );
    expect(warnings).toEqual([
      "Potassium is low for this dinner: 1,500 mg vs about 1,880 mg (40% of your 4,700 mg daily target).",
    ]);
  });

  it("warns when a 0% meal falls back to the default share", async () => {
    const { service, ollamaService, userContextService, stapleFoodService, foodRepo } = createService();
    const stapleFood = { id: 10, foodName: "Chicken", calories: 200, protein: 30, carbs: 0, fat: 8, sodium: 70, fiber: 0, servingSize: 100, servingUnit: "g" };
    stapleFoodService.listWithFood.mockResolvedValue([stapleFood]);
    userContextService.assembleRecipeGenerationContext.mockResolvedValue(
      makeRecipeCtx({ mealSplits: { breakfast: 0.3, lunch: 0.4, dinner: 0.3, snack: 0 } }),
    );
    foodRepo.find.mockResolvedValue([stapleFood]);
    foodRepo.findOne.mockResolvedValue(stapleFood);
    ollamaService.chat.mockResolvedValueOnce(
      JSON.stringify({
        recipe: { name: "Snack", servings: 1, ingredients: [{ foodId: 10, amount: 1 }], steps: [{ order: 1, instruction: "eat" }] },
        recommendation: "",
      }),
    );
    const result = await service.generateRecipe({ mealSlot: "snack", foodIds: [10] } as any, 1);
    expect(result.generationWarnings).toContain(
      "You set snacks to 0% of your day; this recipe uses the default 10%.",
    );
    const [, user] = ollamaService.chat.mock.calls.at(-1)[0] as { content: string }[];
    expect(user.content).toContain("Aim for ONE serving of this snack at about 200 kcal");
  });

  it("clampRecipeToRemainingBudgets scales for phosphorus", () => {
    const { service } = createService();
    const recipe: any = { ingredients: [{ amount_g: 100, amount: 1 }], nutritionPerServing: { calories: 100, phosphorusMg: 400 } };
    const warnings: string[] = [];
    expect((service as any).clampRecipeToRemainingBudgets(recipe, { phosphorusMg: 200 }, warnings)).toBe("adjusted");
    expect(recipe.ingredients[0].amount_g).toBe(50);
  });

  it("verifyBudget warns when phosphorus still exceeds remaining", () => {
    const { service } = createService();
    expect((service as any).verifyBudget({ nutritionPerServing: { phosphorusMg: 400 } }, { phosphorusMg: 200 }, [])).toBe("warning");
  });
});