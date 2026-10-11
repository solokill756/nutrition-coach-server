import axios from "axios";
import { FoodNutritionEntity } from "./entities/food-nutrition.entity";
import { UsdaFoodDataService } from "./usda-food-data.service";

jest.mock("axios");
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

type Row = Partial<FoodNutritionEntity> & { id: number };

function makeRepo() {
  const rows: Row[] = [];
  const repo = {
    rows,
    findOne: jest.fn(async ({ where }: { where: { fdcId: number; delFlag: boolean } }) =>
      rows.find((r) => r.fdcId === where.fdcId && !r.delFlag) ?? null,
    ),
    create: jest.fn((data: Partial<FoodNutritionEntity>) => ({ ...data })),
    save: jest.fn(async (data: Partial<FoodNutritionEntity>) => {
      const row = { ...data, id: rows.length + 1 } as Row;
      rows.push(row);
      return row;
    }),
  };
  return repo;
}

function config(key?: string) {
  return { get: jest.fn((name: string) => (name === "USDA_FDC_API_KEY" ? key : undefined)) };
}

const banana = {
  fdcId: 1105314,
  description: "BANANAS, RAW",
  dataType: "Foundation",
  foodNutrients: [
    { nutrientId: 1008, value: 89 },
    { nutrientId: 1003, value: 1.09 },
    { nutrientId: 1004, value: 0.33 },
    { nutrientId: 1005, value: 22.84 },
    { nutrientId: 1092, value: 358 },
  ],
};

const respond = (foods: unknown[]) => mockedGet.mockResolvedValueOnce({ data: { foods } } as never);

describe("UsdaFoodDataService", () => {
  beforeEach(() => mockedGet.mockReset());

  it("maps a USDA hit to a per-100 g verified food", async () => {
    const repo = makeRepo();
    const service = new UsdaFoodDataService(repo as never, config("k") as never);
    respond([banana]);
    const [food] = await service.searchAndSync("banana", 5);
    expect(food).toMatchObject({
      fdcId: 1105314,
      foodName: "Bananas, raw",
      category: "USDA Foundation",
      calories: 89,
      protein: 1.09,
      fat: 0.33,
      carbs: 22.84,
      potassium: 358,
      fiber: 0,
      sodium: 0,
      sugars: null,
      servingSize: 100,
      servingUnit: "g",
      servingsPerContainer: 1,
      isVerified: true,
      userId: null,
    });
  });

  it("stores 0, not null, for nutrients the food table requires", async () => {
    const repo = makeRepo();
    const service = new UsdaFoodDataService(repo as never, config("k") as never);
    respond([{ ...banana, foodNutrients: [{ nutrientId: 1008, value: 30 }] }]);
    const [food] = await service.searchAndSync("sprouts", 5);
    expect(food).toMatchObject({ protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, calcium: null });
  });

  it("skips a hit that fails to save and keeps the rest", async () => {
    const repo = makeRepo();
    const realSave = repo.save.getMockImplementation()!;
    repo.save.mockImplementationOnce(() => Promise.reject(new Error("constraint")));
    repo.save.mockImplementation(realSave);
    const service = new UsdaFoodDataService(repo as never, config("k") as never);
    respond([{ ...banana, fdcId: 1 }, { ...banana, fdcId: 2 }]);
    const foods = await service.searchAndSync("banana", 5);
    expect(foods.map((f) => f.fdcId)).toEqual([2]);
  });

  it("reuses the stored row for a food it has seen before", async () => {
    const repo = makeRepo();
    const service = new UsdaFoodDataService(repo as never, config("k") as never);
    respond([banana]);
    await service.searchAndSync("banana", 5);
    respond([banana]);
    const [again] = await service.searchAndSync("banana", 5);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(again.id).toBe(1);
  });

  it("skips hits without an energy value", async () => {
    const repo = makeRepo();
    const service = new UsdaFoodDataService(repo as never, config("k") as never);
    respond([{ ...banana, fdcId: 9, foodNutrients: [{ nutrientId: 1003, value: 2 }] }]);
    expect(await service.searchAndSync("x", 5)).toEqual([]);
  });

  it("falls back to Atwater energy when kcal is missing", async () => {
    const repo = makeRepo();
    const service = new UsdaFoodDataService(repo as never, config("k") as never);
    respond([{ ...banana, foodNutrients: [{ nutrientId: 2047, value: 92 }] }]);
    const [food] = await service.searchAndSync("banana", 5);
    expect(food.calories).toBe(92);
  });

  it("returns nothing when USDA cannot be reached", async () => {
    const repo = makeRepo();
    const service = new UsdaFoodDataService(repo as never, config("k") as never);
    mockedGet.mockImplementationOnce(() => Promise.reject(new Error("ETIMEDOUT")));
    expect(await service.searchAndSync("banana", 5)).toEqual([]);
  });

  it("uses DEMO_KEY when no key is configured", async () => {
    const repo = makeRepo();
    const service = new UsdaFoodDataService(repo as never, config("") as never);
    respond([]);
    await service.searchAndSync("banana", 3);
    const params = (mockedGet.mock.calls[0][1] as { params: URLSearchParams }).params;
    expect(params.get("api_key")).toBe("DEMO_KEY");
    expect(params.get("query")).toBe("banana");
    expect(params.get("pageSize")).toBe("3");
  });

  it("percent-encodes the data types (USDA rejects raw parentheses)", async () => {
    const repo = makeRepo();
    const service = new UsdaFoodDataService(repo as never, config("k") as never);
    respond([]);
    await service.searchAndSync("banana", 3);
    const params = (mockedGet.mock.calls[0][1] as { params: URLSearchParams }).params;
    expect(String(params)).toContain("dataType=Foundation%2CSR+Legacy%2CSurvey+%28FNDDS%29");
  });
});
