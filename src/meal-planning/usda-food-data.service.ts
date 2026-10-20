import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import axios from "axios";
import { Repository } from "typeorm";
import { FoodNutritionEntity } from "./entities/food-nutrition.entity";

const SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
const DATA_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)"];

type NutrientField = Exclude<
  keyof FoodNutritionEntity,
  | "id" | "foodName" | "userId" | "category" | "fdcId" | "servingSize" | "servingUnit"
  | "servingsPerContainer" | "isVerified" | "delFlag" | "createdAt" | "updatedAt"
>;

// USDA nutrient ids, in order of preference, for each entity field. Values are per 100 g.
const NUTRIENTS: Record<NutrientField, number[]> = {
  calories: [1008, 2047, 2048],
  protein: [1003],
  fat: [1004],
  carbs: [1005],
  fiber: [1079],
  sugars: [2000, 1063],
  sodium: [1093],
  saturatedFat: [1258],
  cholesterol: [1253],
  potassium: [1092],
  calcium: [1087],
  iron: [1089],
  magnesium: [1090],
  phosphorus: [1091],
  zinc: [1095],
  vitaminA: [1106],
  vitaminC: [1162],
  vitaminD: [1114],
  vitaminE: [1109],
  vitaminK: [1185],
  vitaminB6: [1175],
  vitaminB12: [1178],
  folateDfe: [1190],
};

// Columns that are NOT NULL (default 0) in the Food table.
const REQUIRED: NutrientField[] = ["calories", "protein", "carbs", "fat", "fiber", "sodium"];

type UsdaFood = {
  fdcId: number;
  description: string;
  dataType: string;
  foodNutrients?: { nutrientId: number; value?: number }[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const sentenceCase = (s: string) => {
  const lower = s.trim().toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

/** Searches USDA FoodData Central and keeps the hits as verified per-100 g foods. */
@Injectable()
export class UsdaFoodDataService {
  private readonly logger = new Logger(UsdaFoodDataService.name);
  private warnedDemoKey = false;

  constructor(
    @InjectRepository(FoodNutritionEntity)
    private readonly foodRepo: Repository<FoodNutritionEntity>,
    private readonly config: ConfigService,
  ) {}

  async searchAndSync(query: string, limit: number): Promise<FoodNutritionEntity[]> {
    const hits = await this.search(query, limit);
    const foods: FoodNutritionEntity[] = [];
    for (const hit of hits) {
      try {
        const food = await this.upsert(hit);
        if (food) foods.push(food);
      } catch (error) {
        this.logger.warn(`Skipped USDA food ${hit.fdcId}: ${(error as Error).message}`);
      }
    }
    return foods;
  }

  private async search(query: string, limit: number): Promise<UsdaFood[]> {
    try {
      // POST with a JSON body: USDA's gateway rejects some GET queries
      // (multi-word terms, the "(FNDDS)" data type) with a bare 400.
      const { data } = await axios.post<{ foods?: UsdaFood[] }>(
        SEARCH_URL,
        { query, pageSize: limit, dataType: DATA_TYPES },
        { params: { api_key: this.apiKey() }, timeout: 8000 },
      );
      return data.foods ?? [];
    } catch (error) {
      this.logger.warn(`USDA search failed for "${query}": ${(error as Error).message}`);
      return [];
    }
  }

  private apiKey(): string {
    const key = (this.config.get<string>("USDA_FDC_API_KEY") ?? "").trim();
    if (key) return key;
    if (!this.warnedDemoKey) {
      this.warnedDemoKey = true;
      this.logger.warn("USDA_FDC_API_KEY is not set; using DEMO_KEY (heavily rate limited)");
    }
    return "DEMO_KEY";
  }

  private async upsert(hit: UsdaFood): Promise<FoodNutritionEntity | null> {
    const existing = await this.foodRepo.findOne({ where: { fdcId: hit.fdcId, delFlag: false } });
    if (existing) return existing;

    const values = new Map((hit.foodNutrients ?? []).map((n) => [n.nutrientId, n.value]));
    const pick = (ids: number[]) => {
      for (const id of ids) {
        const v = values.get(id);
        if (typeof v === "number" && Number.isFinite(v)) return round2(v);
      }
      return null;
    };

    const nutrients = Object.fromEntries(
      Object.entries(NUTRIENTS).map(([field, ids]) => [field, pick(ids)]),
    ) as Record<NutrientField, number | null>;
    if (nutrients.calories == null) return null;
    for (const field of REQUIRED) nutrients[field] ??= 0;

    return this.foodRepo.save(
      this.foodRepo.create({
        ...nutrients,
        foodName: sentenceCase(hit.description),
        category: `USDA ${hit.dataType}`,
        fdcId: hit.fdcId,
        servingSize: 100,
        servingUnit: "g",
        servingsPerContainer: 1,
        userId: null,
        isVerified: true,
        delFlag: false,
      } as Partial<FoodNutritionEntity>),
    );
  }
}
