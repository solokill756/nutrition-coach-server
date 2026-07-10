import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateRecipeDto } from "./recipe.dto";

const validationOptions = { whitelist: true, forbidNonWhitelisted: true };

function flutterUpdatePayload() {
  return {
    name: "Chicken Bowl",
    shareWith: 1,
    servings: 1,
    prepMinutes: 0,
    cookMinutes: 0,
    difficulty: "easy",
    tags: [],
    ingredients: [
      {
        foodId: 10,
        name: "Chicken",
        quantity: 1,
        unit: "g",
        calories: 200,
        protein: 30,
        carbs: 0,
        fat: 8,
      },
    ],
    steps: [{ order: 1, instruction: "cook" }],
    sourceType: "ai_recipe_builder",
    dateKey: "2026-06-23",
    mealSlot: "lunch",
  };
}

describe("UpdateRecipeDto", () => {
  it("accepts AI recipe metadata fields sent by the Flutter update payload", async () => {
    const dto = plainToInstance(UpdateRecipeDto, flutterUpdatePayload());
    const errors = await validate(dto, validationOptions);
    expect(errors).toHaveLength(0);
  });

  it("accepts score and warnings from Flutter create/update payload", async () => {
    const dto = plainToInstance(UpdateRecipeDto, {
      ...flutterUpdatePayload(),
      score: 0.82,
      warnings: ["Calories differs from the slot target by about 20%."],
    });
    const errors = await validate(dto, validationOptions);
    expect(errors).toHaveLength(0);
  });
});
