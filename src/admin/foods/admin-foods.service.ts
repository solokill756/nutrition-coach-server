import { HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FoodNutritionEntity } from "../../meal-planning/entities/food-nutrition.entity";
import { AdminFoodException } from "./admin-foods.exception";
import { AdminFoodListQueryDto, AdminFoodSortBy } from "./dto/admin-food-list-query.dto";
import {
  AdminFoodDeleteResponseDto,
  AdminFoodDetailEnvelopeDto,
  AdminFoodDetailResponseDto,
  AdminFoodListResponseDto,
  AdminFoodResponseDto,
  AdminFoodVerifyResponseDto,
  AdminFoodWriteResponseDto,
} from "./dto/admin-food-response.dto";
import { CreateAdminFoodRequestDto } from "./dto/create-admin-food-request.dto";
import { UpdateAdminFoodRequestDto } from "./dto/update-admin-food-request.dto";
import { UpdateFoodVerifyRequestDto } from "./dto/update-food-verify-request.dto";

type FoodSortableColumn = "food.createdAt" | "food.foodName" | "food.calories" | "food.protein";

const SORT_COLUMN_MAP: Record<AdminFoodSortBy, FoodSortableColumn> = {
  createdAt: "food.createdAt",
  foodName: "food.foodName",
  calories: "food.calories",
  proteinG: "food.protein",
};

const FOOD_LIST_SELECT = [
  "food.id",
  "food.foodName",
  "food.servingUnit",
  "food.category",
  "food.servingSize",
  "food.calories",
  "food.protein",
  "food.carbs",
  "food.fat",
  "food.fiber",
  "food.sodium",
  "food.saturatedFat",
  "food.cholesterol",
  "food.sugars",
  "food.potassium",
  "food.calcium",
  "food.iron",
  "food.magnesium",
  "food.phosphorus",
  "food.zinc",
  "food.vitaminA",
  "food.vitaminC",
  "food.vitaminD",
  "food.vitaminE",
  "food.vitaminK",
  "food.vitaminB6",
  "food.vitaminB12",
  "food.folateDfe",
  "food.isVerified",
  "food.createdAt",
  "food.updatedAt",
];

@Injectable()
export class AdminFoodsService {
  constructor(
    @InjectRepository(FoodNutritionEntity)
    private readonly foodRepo: Repository<FoodNutritionEntity>,
  ) {}

  async list(query: AdminFoodListQueryDto): Promise<AdminFoodListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? "createdAt";
    const sortOrder = (query.sortOrder ?? "desc").toUpperCase() as "ASC" | "DESC";
    const qb = this.foodRepo
      .createQueryBuilder("food")
      .where("food.delFlag = :delFlag", { delFlag: false });

    if (query.keyword?.trim()) {
      qb.andWhere("food.foodName ILIKE :keyword", { keyword: `%${query.keyword.trim()}%` });
    }

    if (query.category?.trim()) {
      qb.andWhere("food.category = :category", { category: query.category.trim() });
    }

    if (query.isVerified !== undefined) {
      qb.andWhere("food.isVerified = :isVerified", { isVerified: query.isVerified });
    }

    const [total, rows] = await Promise.all([
      qb.clone().getCount(),
      qb
      .clone()
      .select(FOOD_LIST_SELECT)
      .orderBy(SORT_COLUMN_MAP[sortBy], sortOrder)
      .skip((page - 1) * limit)
      .take(limit)
      .getMany(),
    ]);

    return {
      success: true,
      data: rows.map((food) => this.toListItem(food)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async detail(id: number): Promise<AdminFoodDetailEnvelopeDto> {
    const food = await this.findActiveFoodOrThrow(id);
    return {
      success: true,
      data: this.toDetail(food),
    };
  }

  async create(dto: CreateAdminFoodRequestDto): Promise<AdminFoodWriteResponseDto> {
    const foodName = this.normalizeRequiredText(dto.foodName);
    await this.assertFoodNameAvailable(foodName);

    const saved = await this.foodRepo.save(
      this.foodRepo.create({
        foodName,
        servingUnit: this.normalizeRequiredText(dto.servingUnit) || "g",
        category: this.normalizeOptionalText(dto.category),
        servingSize: dto.servingSize,
        calories: dto.calories,
        protein: dto.proteinG,
        carbs: dto.totalCarbohydratesG,
        fat: dto.totalFatG,
        fiber: dto.fiberG ?? 0,
        sodium: dto.sodiumMg ?? 0,
        saturatedFat: dto.saturatedFatG ?? null,
        cholesterol: dto.cholesterolMg ?? null,
        sugars: dto.sugarsG ?? null,
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
        isVerified: dto.isVerified ?? true,
        userId: null,
        delFlag: false,
        servingsPerContainer: 1,
      }),
    );

    return {
      success: true,
      message: "Food created successfully",
      data: {
        id: Number(saved.id),
        foodName: saved.foodName,
      },
    };
  }

  async update(id: number, dto: UpdateAdminFoodRequestDto): Promise<AdminFoodWriteResponseDto> {
    const food = await this.findActiveFoodOrThrow(id);

    if (dto.foodName !== undefined) {
      const foodName = this.normalizeRequiredText(dto.foodName);
      if (foodName.toLowerCase() !== food.foodName.toLowerCase()) {
        await this.assertFoodNameAvailable(foodName, id);
      }
      food.foodName = foodName;
    }

    if (dto.servingUnit !== undefined) food.servingUnit = this.normalizeRequiredText(dto.servingUnit) || "g";
    if (dto.category !== undefined) food.category = this.normalizeOptionalText(dto.category);
    if (dto.servingSize !== undefined) food.servingSize = dto.servingSize;
    if (dto.calories !== undefined) food.calories = dto.calories;
    if (dto.proteinG !== undefined) food.protein = dto.proteinG;
    if (dto.totalCarbohydratesG !== undefined) food.carbs = dto.totalCarbohydratesG;
    if (dto.totalFatG !== undefined) food.fat = dto.totalFatG;
    if (dto.fiberG !== undefined) food.fiber = dto.fiberG;
    if (dto.sodiumMg !== undefined) food.sodium = dto.sodiumMg;
    if (dto.saturatedFatG !== undefined) food.saturatedFat = dto.saturatedFatG;
    if (dto.cholesterolMg !== undefined) food.cholesterol = dto.cholesterolMg;
    if (dto.sugarsG !== undefined) food.sugars = dto.sugarsG;
    if (dto.potassiumMg !== undefined) food.potassium = dto.potassiumMg;
    if (dto.calciumMg !== undefined) food.calcium = dto.calciumMg;
    if (dto.ironMg !== undefined) food.iron = dto.ironMg;
    if (dto.magnesiumMg !== undefined) food.magnesium = dto.magnesiumMg;
    if (dto.phosphorusMg !== undefined) food.phosphorus = dto.phosphorusMg;
    if (dto.zincMg !== undefined) food.zinc = dto.zincMg;
    if (dto.vitaminAUg !== undefined) food.vitaminA = dto.vitaminAUg;
    if (dto.vitaminCMg !== undefined) food.vitaminC = dto.vitaminCMg;
    if (dto.vitaminDUg !== undefined) food.vitaminD = dto.vitaminDUg;
    if (dto.vitaminEMg !== undefined) food.vitaminE = dto.vitaminEMg;
    if (dto.vitaminKUg !== undefined) food.vitaminK = dto.vitaminKUg;
    if (dto.vitaminB6Mg !== undefined) food.vitaminB6 = dto.vitaminB6Mg;
    if (dto.vitaminB12Ug !== undefined) food.vitaminB12 = dto.vitaminB12Ug;
    if (dto.folateDfeUg !== undefined) food.folateDfe = dto.folateDfeUg;
    if (dto.isVerified !== undefined) food.isVerified = dto.isVerified;

    food.updatedAt = new Date();
    const saved = await this.foodRepo.save(food);

    return {
      success: true,
      message: "Food updated successfully",
      data: {
        id: Number(saved.id),
        foodName: saved.foodName,
      },
    };
  }

  async softDelete(id: number): Promise<AdminFoodDeleteResponseDto> {
    const food = await this.findActiveFoodOrThrow(id);
    food.delFlag = true;
    food.updatedAt = new Date();
    await this.foodRepo.save(food);

    return {
      success: true,
      message: "Food deleted successfully",
    };
  }

  async updateVerify(id: number, dto: UpdateFoodVerifyRequestDto): Promise<AdminFoodVerifyResponseDto> {
    const food = await this.findActiveFoodOrThrow(id);
    food.isVerified = dto.isVerified;
    food.updatedAt = new Date();
    const saved = await this.foodRepo.save(food);

    return {
      success: true,
      message: "Food verification status updated successfully",
      data: {
        id: Number(saved.id),
        isVerified: saved.isVerified,
      },
    };
  }

  private async findActiveFoodOrThrow(id: number): Promise<FoodNutritionEntity> {
    const food = await this.foodRepo.findOne({ where: { id, delFlag: false } });
    if (!food) {
      throw new AdminFoodException("FOOD_NOT_FOUND", HttpStatus.NOT_FOUND);
    }
    return food;
  }

  private async assertFoodNameAvailable(foodName: string, excludeId?: number): Promise<void> {
    const qb = this.foodRepo
      .createQueryBuilder("food")
      .where("food.delFlag = :delFlag", { delFlag: false })
      .andWhere("lower(food.foodName) = :foodName", { foodName: foodName.toLowerCase() });

    if (excludeId !== undefined) {
      qb.andWhere("food.id != :excludeId", { excludeId });
    }

    const existing = await qb.getOne();
    if (existing) {
      throw new AdminFoodException("FOOD_NAME_ALREADY_EXISTS", HttpStatus.CONFLICT);
    }
  }

  private toListItem(food: FoodNutritionEntity): AdminFoodResponseDto {
    return {
      id: Number(food.id),
      foodName: food.foodName,
      servingUnit: food.servingUnit,
      category: food.category,
      servingSize: food.servingSize,
      calories: food.calories,
      proteinG: food.protein,
      totalCarbohydratesG: food.carbs,
      totalFatG: food.fat,
      fiberG: food.fiber,
      sodiumMg: food.sodium,
      saturatedFatG: food.saturatedFat,
      cholesterolMg: food.cholesterol,
      sugarsG: food.sugars,
      potassiumMg: food.potassium,
      calciumMg: food.calcium,
      ironMg: food.iron,
      magnesiumMg: food.magnesium,
      phosphorusMg: food.phosphorus,
      zincMg: food.zinc,
      vitaminAUg: food.vitaminA,
      vitaminCMg: food.vitaminC,
      vitaminDUg: food.vitaminD,
      vitaminEMg: food.vitaminE,
      vitaminKUg: food.vitaminK,
      vitaminB6Mg: food.vitaminB6,
      vitaminB12Ug: food.vitaminB12,
      folateDfeUg: food.folateDfe,
      isVerified: food.isVerified,
      createdAt: food.createdAt.toISOString(),
      updatedAt: food.updatedAt.toISOString(),
    };
  }

  private toDetail(food: FoodNutritionEntity): AdminFoodDetailResponseDto {
    return {
      ...this.toListItem(food),
      userId: food.userId == null ? null : Number(food.userId),
    };
  }

  private normalizeRequiredText(value: string): string {
    return String(value || "").trim();
  }

  private normalizeOptionalText(value: string | undefined): string | null {
    const normalized = String(value || "").trim();
    return normalized.length > 0 ? normalized : null;
  }
}
