import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { Repository, ILike } from "typeorm";
import { FoodNutritionEntity } from "./entities/food-nutrition.entity";
import { CreateFoodDto } from "./dto/create-food.dto";
import axios from "axios";
import { OllamaService } from "../ollama/ollama.service";
import { FOOD_PROMPTS } from "./constants/food-prompts";

export interface FoodNutrition {
  id: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  sodium: number;
  servingSize: number;
}

@Injectable()
export class FoodService {
  private readonly fatSecretBaseUrl = "https://platform.fatsecret.com/rest";
  private readonly fatSecretTokenUrl = "https://oauth.fatsecret.com/connect/token";

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    @InjectRepository(FoodNutritionEntity)
    private readonly foodRepo: Repository<FoodNutritionEntity>,
    private readonly config: ConfigService,
    private readonly ollamaService: OllamaService,
  ) { }

  async createFood(userId: number, dto: CreateFoodDto): Promise<FoodNutritionEntity> {
    const foodName = (dto.category || dto.description || "Food").trim();
    const servingsPerContainer =
      dto.servingsPerContainer ?? dto.servingPerContainer ?? dto.servings_per_container ?? 1;
    const row = this.foodRepo.create({
      foodName,
      category: dto.brandName?.trim() || null,
      calories: dto.calories ?? 0,
      protein: dto.proteinG ?? 0,
      carbs: dto.totalCarbohydratesG ?? 0,
      fat: dto.totalFatG ?? 0,
      saturatedFat: dto.saturatedFatG ?? null,
      cholesterol: dto.cholesterolMg ?? null,
      fiber: dto.dietaryFibersG ?? 0,
      sugars: dto.sugarsG ?? null,
      sodium: dto.sodiumMg ?? 0,
      potassium: dto.potassiumMg ?? null,
      calcium: dto.calciumMg ?? null,
      iron: dto.ironMg ?? null,
      magnesium: dto.magnesiumMg ?? null,
      phosphorus: dto.phosphorusMg ?? null,
      zinc: dto.zincMg ?? null,
      vitaminA: dto.vitaminAUg ?? null,
      vitaminC: dto.vitaminCMg ?? null,
      vitaminD: dto.vitaminDUg ?? null,
      vitaminE: dto.vitaminEMg ?? null,
      vitaminK: dto.vitaminKUg ?? null,
      vitaminB6: dto.vitaminB6Mg ?? null,
      vitaminB12: dto.vitaminB12Ug ?? null,
      folateDfe: dto.folateDfeUg ?? null,
      servingSize: dto.servingSize ?? 100,
      servingUnit: dto.servingUnit?.trim() || "g",
      servingsPerContainer,
      userId,
      // User-created foods must be unverified until moderation.
      isVerified: false,
      delFlag: false,
    });
    return this.foodRepo.save(row);
  }

  async searchFood(name: string, skipAIEstimate = false): Promise<FoodNutritionEntity | null> {
    if (!name || name.trim().length < 2) return null;

    // 1. Ưu tiên tìm trong DB nội bộ
    const food = await this.foodRepo.findOne({
      where: { foodName: ILike(`%${name}%`), delFlag: false },
      order: { calories: "DESC" } as any,
    });

    if (food && food.calories > 0) return food;

    // 2. Làm sạch tên và dịch sang tiếng Anh
    const cleanName = this.sanitizeQuery(name);
    const englishName = await this.translateToEnglish(cleanName);
    console.log(`[FOOD-SERVICE] 🌐 Translated '${cleanName}' -> '${englishName}'`);

    // 3. Nếu không có trong DB, tìm từ FatSecret (OAuth client credentials)
    const fatSecretResult = await this.fetchAndSyncFromFatSecret(englishName || cleanName);
    if (fatSecretResult) return fatSecretResult;

    // 4. Cuối cùng mới dùng AI ước lượng
    if (skipAIEstimate) return null;
    return this.estimateNutritionWithAI(cleanName);
  }

  private async getFatSecretAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const clientId = this.config.get<string>("FATSECRET_CLIENT_ID");
    const clientSecret = this.config.get<string>("FATSECRET_CLIENT_SECRET");
    const scope = this.config.get<string>("FATSECRET_SCOPE") || "basic";
    if (!clientId || !clientSecret) {
      console.warn("[FOOD-SERVICE] FATSECRET_CLIENT_ID/SECRET missing");
      return null;
    }

    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        scope,
      });
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const response = await axios.post(this.fatSecretTokenUrl, body.toString(), {
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      const token = response.data?.access_token as string | undefined;
      const expiresIn = Number(response.data?.expires_in ?? 3600);
      if (!token) return null;
      this.accessToken = token;
      this.tokenExpiry = Date.now() + Math.max(expiresIn - 60, 60) * 1000;
      return token;
    } catch (error: any) {
      console.error("[FOOD-SERVICE] ❌ FatSecret token fetch failed:", error.response?.data || error.message);
      return null;
    }
  }

  private async fetchAndSyncFromFatSecret(query: string): Promise<FoodNutritionEntity | null> {
    console.log(`[FOOD-SERVICE] 🔍 Searching FatSecret (OAuth2) for: ${query}...`);

    const token = await this.getFatSecretAccessToken();
    if (!token) return null;

    const url = `${this.fatSecretBaseUrl}/foods/search/v1`;

    try {
      const response = await axios.get(url, {
        params: {
          search_expression: query,
          format: "json",
          page_number: 0,
          max_results: 10,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const foods =
        response.data?.foods_search?.results?.food ??
        response.data?.foods?.food ??
        [];
      if (!foods || (Array.isArray(foods) && foods.length === 0)) return null;

      const foodItem = Array.isArray(foods) ? foods[0] : foods;
      const desc = foodItem.food_description || "";
      
      const calories = parseFloat(desc.match(/Calories: (\d+)kcal/)?.[1] || "0");
      const fat = parseFloat(desc.match(/Fat: ([\d.]+)g/)?.[1] || "0");
      const carbs = parseFloat(desc.match(/Carbs: ([\d.]+)g/)?.[1] || "0");
      const protein = parseFloat(desc.match(/Protein: ([\d.]+)g/)?.[1] || "0");

      const nutritionData: Partial<FoodNutritionEntity> = {
        foodName: foodItem.food_name,
        category: foodItem.brand_name || "FatSecret Generic",
        calories: calories,
        protein: protein,
        carbs: carbs,
        fat: fat,
        sodium: 0,
        servingSize: 100,
        servingUnit: "g",
        servingsPerContainer: 1,
        isVerified: true,
        delFlag: false,
      };

      const newFood = this.foodRepo.create(nutritionData);
      return await this.foodRepo.save(newFood);
    } catch (error: any) {
      console.error(`[FOOD-SERVICE] ❌ FatSecret search failed for ${query}:`, error.response?.data || error.message);
    }
    return null;
  }

  private async estimateNutritionWithAI(name: string): Promise<FoodNutritionEntity | null> {
    try {
      console.log(`[FOOD-SERVICE] 🤖 AI Estimating nutrition for: ${name}...`);
      const prompt = FOOD_PROMPTS.NUTRITION_ESTIMATION(name);

      const response = await this.ollamaService.chat([
        { role: "system", content: "You are a nutrition database. Return only JSON." },
        { role: "user", content: prompt }
      ]);

      const jsonMatch = response.match(/\{.*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        const nutritionData: Partial<FoodNutritionEntity> = {
          foodName: `[AI Estimate] ${name}`,
          category: "AI Estimated",
          calories: Number(data.calories) || 0,
          protein: Number(data.protein) || 0,
          carbs: Number(data.carbs) || 0,
          fat: Number(data.fat) || 0,
          sodium: Number(data.sodium) || 0,
          servingSize: 100,
          servingUnit: "g",
          servingsPerContainer: 1,
          isVerified: false,
          delFlag: false,
        };
        // Intentionally do not persist AI-estimated foods into DB.
        // We only return a transient entity for in-memory usage.
        return this.foodRepo.create(nutritionData);
      }
    } catch (error) {
      console.error("[FOOD-SERVICE] AI Nutrition Estimation failed:", error);
    }
    return null;
  }

  private sanitizeQuery(query: string): string {
    return query
      .replace(/\(.*\)/g, "") // Loại bỏ nội dung trong ngoặc đơn
      .replace(/with.*|such as.*|style.*/gi, "") // Loại bỏ các cụm ghi chú
      .replace(/fresh|roasted|grilled|steamed|boiled|cooked|raw|organic|large|small|medium/gi, "") // Loại bỏ tính từ
      .replace(/[,.;]/g, " ") // Thay thế dấu phẩy, chấm bằng khoảng trắng
      .replace(/\s+/g, " ") // Thu gọn khoảng trắng thừa
      .trim();
  }

  private async translateToEnglish(text: string): Promise<string> {
    // 1. Nếu đã là tiếng Anh, bỏ qua
    if (/^[a-zA-Z0-9\s]*$/.test(text) && text.split(' ').length > 0) {
      return text;
    }

    // 2. Thử dùng Google Translate "Free" endpoint (No API Key required)
    try {
      console.log("[FOOD-SERVICE] 🌐 Translating via Google (Free)...");
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
      const response = await axios.get(url);
      // Cấu trúc phản hồi của endpoint này là mảng lồng nhau: [[["Dịch", "Gốc", null, null, 1]], null, "vi"]
      const translated = response.data?.[0]?.[0]?.[0];
      if (translated) return translated;
    } catch (error) {
      console.error("[FOOD-SERVICE] Google Free Translation failed:", (error as any).message);
    }

    // 3. Fallback via configured LLM (platform/gemini) if Google fails
    try {
      console.log("[FOOD-SERVICE] Translating via LLM fallback...");
      const response = await this.ollamaService.chat([
        { role: "user", content: FOOD_PROMPTS.TRANSLATION(text) },
      ]);

      return response.replace(/["']/g, "").trim();
    } catch (error) {
      console.error("[FOOD-SERVICE] LLM translation fallback failed:", error);
      return text;
    }
  }
}
