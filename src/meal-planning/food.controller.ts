import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { FoodNutritionEntity } from "./entities/food-nutrition.entity";
import { FoodService } from "./food.service";
import { UsdaFoodDataService } from "./usda-food-data.service";
import { CreateFoodDto } from "./dto/create-food.dto";
import { UpdateFoodDto } from "./dto/update-food.dto";

/**
 * REST surface expected by the Flutter app (`api/Food`).
 * Backed by the `Food` table via {@link FoodNutritionEntity}.
 */
@Controller("api/Food")
@UseGuards(JwtAuthGuard)
export class FoodController {
  constructor(
    @InjectRepository(FoodNutritionEntity)
    private readonly foodRepo: Repository<FoodNutritionEntity>,
    private readonly foodService: FoodService,
    private readonly usda: UsdaFoodDataService,
  ) {}

  /** Serialize numeric column; use `null` when DB value is missing so clients can show "no data" vs 0. */
  private numOrNull(v: unknown): number | null {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private toApiItem(f: FoodNutritionEntity): Record<string, unknown> {
    const row = f as FoodNutritionEntity & {
      calories?: number | null;
      protein?: number | null;
      carbs?: number | null;
      fat?: number | null;
      saturatedFat?: number | null;
      cholesterol?: number | null;
      fiber?: number | null;
      sugars?: number | null;
      sodium?: number | null;
      potassium?: number | null;
      fdcId?: number | null;
      calcium?: number | null;
      iron?: number | null;
      magnesium?: number | null;
      phosphorus?: number | null;
      zinc?: number | null;
      vitaminA?: number | null;
      vitaminC?: number | null;
      vitaminD?: number | null;
      vitaminE?: number | null;
      vitaminK?: number | null;
      vitaminB6?: number | null;
      vitaminB12?: number | null;
      folateDfe?: number | null;
      servingsPerContainer?: number | null;
    };
    const carbs = this.numOrNull(row.carbs);
    const fat = this.numOrNull(row.fat);
    const protein = this.numOrNull(row.protein);
    const c = carbs ?? 0;
    const fa = fat ?? 0;
    const p = protein ?? 0;
    const derivedKcal = c * 4 + fa * 9 + p * 4;
    let calories = this.numOrNull(row.calories);
    if ((calories == null || calories === 0) && derivedKcal > 0) {
      calories = Math.round(derivedKcal * 100) / 100;
    }
    return {
      id: Number(f.id),
      fdcId: this.numOrNull(row.fdcId),
      foodName: f.foodName,
      description: f.foodName,
      brandName: f.category ?? "",
      servingSize: f.servingSize,
      servingUnit: f.servingUnit,
      servingsPerContainer: this.numOrNull(row.servingsPerContainer) ?? 1,
      calories,
      totalFatG: fat,
      saturatedFatG: this.numOrNull(row.saturatedFat),
      transFatG: 0,
      polyunsaturatedFatG: 0,
      monounsaturatedFatG: 0,
      cholesterolMg: this.numOrNull(row.cholesterol),
      sodiumMg: this.numOrNull(row.sodium),
      totalCarbohydratesG: carbs,
      dietaryFibersG: this.numOrNull(row.fiber),
      sugarsG: this.numOrNull(row.sugars),
      proteinG: protein,
      potassiumMg: this.numOrNull(row.potassium),
      calciumMg: this.numOrNull(row.calcium),
      ironMg: this.numOrNull(row.iron),
      magnesiumMg: this.numOrNull(row.magnesium),
      phosphorusMg: this.numOrNull(row.phosphorus),
      zincMg: this.numOrNull(row.zinc),
      vitaminAUg: this.numOrNull(row.vitaminA),
      vitaminCMg: this.numOrNull(row.vitaminC),
      vitaminDUg: this.numOrNull(row.vitaminD),
      vitaminEMg: this.numOrNull(row.vitaminE),
      vitaminKUg: this.numOrNull(row.vitaminK),
      vitaminB6Mg: this.numOrNull(row.vitaminB6),
      vitaminB12Ug: this.numOrNull(row.vitaminB12),
      folateDfeUg: this.numOrNull(row.folateDfe),
      vitaminAPercent: 0,
      isVerified: Boolean(f.isVerified),
    };
  }

  @Get()
  async list(
    @Req() req: Request & { user: { userId: number } },
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("pageSize", new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
    @Query("includeAll") includeAll?: string,
    @Query("search") search?: string,
    @Query("mineOnly") mineOnly?: string,
    @Query("ids") ids?: string,
    @Query("allowExternalSearch") allowExternalSearch?: string,
  ) {
    if (ids && ids.trim().length > 0) {
      const idList = ids.split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
      if (idList.length > 0) {
        const rows = await this.foodRepo.find({
          where: { id: In(idList), delFlag: false },
        });
        return {
          items: rows.map((r) => this.toApiItem(r)),
          total: rows.length,
          page: 1,
          pageSize: rows.length,
        };
      }
    }

    const take = Math.min(Math.max(pageSize, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;

    const qb = this.foodRepo
      .createQueryBuilder("f")
      .where("f.delFlag = :delFlag", { delFlag: false });
    const hideAi =
      includeAll === "false" ||
      includeAll === "0" ||
      String(includeAll).toLowerCase() === "false";

    const parts: string[] = [];
    const params: Record<string, unknown> = {};
    const trimmedSearch = search?.trim() ?? "";
    const hasSearch = trimmedSearch.length > 0;
    if (hasSearch) {
      parts.push("f.foodName ILIKE :q");
      params.q = `%${trimmedSearch}%`;
    }
    if (hideAi) {
      parts.push("COALESCE(f.category, '') NOT ILIKE :ai");
      params.ai = "%AI Estimated%";
    }
    const onlyMine =
      mineOnly === "true" ||
      mineOnly === "1" ||
      String(mineOnly).toLowerCase() === "true";
    if (onlyMine) {
      parts.push("f.userId = :userId");
      params.userId = req.user.userId;
    }
    for (const part of parts) {
      qb.andWhere(part, params);
    }
    qb.orderBy("f.id", "ASC").skip(skip).take(take);
    const rows = await qb.getMany();
    const externalAllowed =
      allowExternalSearch === "true" ||
      allowExternalSearch === "1" ||
      String(allowExternalSearch).toLowerCase() === "true";
    // External sources only fill an empty first page; later pages would re-fetch the same hits.
    if (rows.length === 0 && hasSearch && !onlyMine && externalAllowed && Math.max(page, 1) === 1) {
      const usdaFoods = await this.usda.searchAndSync(trimmedSearch, take);
      if (usdaFoods.length > 0) {
        return {
          items: usdaFoods.map((f) => this.toApiItem(f)),
          total: usdaFoods.length,
          page: Math.max(page, 1),
          pageSize: take,
        };
      }
      const fallback = await this.foodService.searchFood(trimmedSearch, hideAi);
      if (fallback) {
        return {
          items: [this.toApiItem(fallback)],
          total: 1,
          page: Math.max(page, 1),
          pageSize: take,
        };
      }
    }
    const total = hasSearch ? rows.length : await qb.getCount();
    return {
      items: rows.map((r) => this.toApiItem(r)),
      total,
      page: Math.max(page, 1),
      pageSize: take,
    };
  }

  @Get(":id")
  async getById(@Param("id", ParseIntPipe) id: number) {
    const f = await this.foodRepo.findOne({ where: { id, delFlag: false } });
    if (!f) {
      throw new NotFoundException({
        errorKey: "food.errors.notFound",
        message: "Food not found",
      });
    }
    return this.toApiItem(f);
  }

  @Post()
  async create(
    @Req() req: Request & { user: { userId: number } },
    @Body() body: CreateFoodDto,
  ) {
    const saved = await this.foodService.createFood(req.user.userId, body);
    return this.toApiItem(saved);
  }

  @Put(":id")
  async update(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateFoodDto,
  ) {
    const f = await this.foodRepo.findOne({ where: { id, userId: req.user.userId, delFlag: false } });
    if (!f) {
      throw new NotFoundException({
        errorKey: "food.errors.notFound",
        message: "Food not found",
      });
    }
    const foodName = (body.category ?? body.description)?.trim();
    if (foodName) f.foodName = foodName;
    if (body.brandName !== undefined) f.category = body.brandName?.trim() || null;
    if (body.calories != null) f.calories = body.calories;
    if (body.proteinG != null) f.protein = body.proteinG;
    if (body.totalCarbohydratesG != null) f.carbs = body.totalCarbohydratesG;
    if (body.totalFatG != null) f.fat = body.totalFatG;
    if (body.saturatedFatG != null) f.saturatedFat = body.saturatedFatG;
    if (body.cholesterolMg != null) f.cholesterol = body.cholesterolMg;
    if (body.dietaryFibersG != null) f.fiber = body.dietaryFibersG;
    if (body.sugarsG != null) f.sugars = body.sugarsG;
    if (body.sodiumMg != null) f.sodium = body.sodiumMg;
    if (body.potassiumMg != null) f.potassium = body.potassiumMg;
    if (body.calciumMg != null) f.calcium = body.calciumMg;
    if (body.ironMg != null) f.iron = body.ironMg;
    if (body.magnesiumMg != null) f.magnesium = body.magnesiumMg;
    if (body.phosphorusMg != null) f.phosphorus = body.phosphorusMg;
    if (body.zincMg != null) f.zinc = body.zincMg;
    if (body.vitaminAUg != null) f.vitaminA = body.vitaminAUg;
    if (body.vitaminCMg != null) f.vitaminC = body.vitaminCMg;
    if (body.vitaminDUg != null) f.vitaminD = body.vitaminDUg;
    if (body.vitaminEMg != null) f.vitaminE = body.vitaminEMg;
    if (body.vitaminKUg != null) f.vitaminK = body.vitaminKUg;
    if (body.vitaminB6Mg != null) f.vitaminB6 = body.vitaminB6Mg;
    if (body.vitaminB12Ug != null) f.vitaminB12 = body.vitaminB12Ug;
    if (body.folateDfeUg != null) f.folateDfe = body.folateDfeUg;
    if (body.servingSize != null && body.servingSize > 0) f.servingSize = body.servingSize;
    if (body.servingUnit != null) f.servingUnit = body.servingUnit.trim() || f.servingUnit;
    const servingsPerContainer =
      body.servingsPerContainer ?? body.servingPerContainer ?? body.servings_per_container;
    if (servingsPerContainer != null && servingsPerContainer > 0) f.servingsPerContainer = servingsPerContainer;
    const saved = await this.foodRepo.save(f);
    return this.toApiItem(saved);
  }

  @Delete(":id")
  async remove(
    @Req() req: Request & { user: { userId: number } },
    @Param("id", ParseIntPipe) id: number,
  ) {
    const food = await this.foodRepo.findOne({
      where: { id, userId: req.user.userId, delFlag: false },
    });
    if (!food) {
      throw new NotFoundException({
        errorKey: "food.errors.notFound",
        message: "Food not found",
      });
    }

    food.delFlag = true;
    food.updatedAt = new Date();
    await this.foodRepo.save(food);
    return { message: "OK", statusCode: 200 };
  }
}
