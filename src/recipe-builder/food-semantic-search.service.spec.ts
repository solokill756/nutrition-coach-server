import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { VectorService } from "../retrieval/vector.service";
import { FoodSemanticSearchService } from "./food-semantic-search.service";

describe("FoodSemanticSearchService", () => {
  function makeService(queryMock: jest.Mock) {
    const dataSource = { query: queryMock } as unknown as DataSource;
    const config = {
      get: jest.fn((key: string) => {
        if (key === "POSTGRES_SCHEMA") return "public";
        if (key === "POSTGRES_VECTOR_DIM") return "768";
        return undefined;
      }),
    } as unknown as ConfigService;
    const vector = {
      getQueryEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    } as unknown as VectorService;
    return new FoodSemanticSearchService(dataSource, config, vector);
  }

  it("maps semantic food candidates", async () => {
    const queryMock = jest.fn().mockResolvedValue([
      {
        foodId: "12",
        foodName: "Chicken Breast",
        brandName: "Poultry",
        servingSize: "100",
        servingUnit: "g",
        calories: "165",
        proteinG: "31",
        totalCarbohydratesG: "0",
        totalFatG: "3.6",
        sodiumMg: "74",
        isVerified: true,
        score: "0.91",
      },
    ]);
    const service = makeService(queryMock);

    await expect(service.searchIngredient("chicken", 5)).resolves.toEqual([
      {
        foodId: 12,
        foodName: "Chicken Breast",
        brandName: "Poultry",
        servingSize: 100,
        servingUnit: "g",
        calories: 165,
        proteinG: 31,
        totalCarbohydratesG: 0,
        totalFatG: 3.6,
        sodiumMg: 74,
        isVerified: true,
        score: 0.91,
      },
    ]);
  });

  it("falls back to keyword search when semantic query fails", async () => {
    const queryMock = jest
      .fn()
      .mockRejectedValueOnce(new Error("vector unavailable"))
      .mockResolvedValueOnce([
        {
          foodId: 5,
          foodName: "Egg",
          brandName: "",
          servingSize: 1,
          servingUnit: "egg",
          calories: 70,
          proteinG: 6,
          totalCarbohydratesG: 1,
          totalFatG: 5,
          sodiumMg: 65,
          isVerified: true,
          score: 0.68,
        },
      ]);
    const service = makeService(queryMock);

    const result = await service.searchIngredient("egg", 5);

    expect(result[0].foodId).toBe(5);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});

