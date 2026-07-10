import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import { LogFoodEntity, LogFoodMealTypeEnum } from "./entities/log-food.entity";
import { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";
import { MealEntity } from "../meal-planning/entities/meal.entity";
import { CreateLogFoodDto } from "./dto/create-log-food.dto";
import { calendarDayBounds } from "../common/date/calendar-day-bounds";

const MEAL_SLUG_TO_INT: Record<string, number> = {
  breakfast: 1,
  lunch: 2,
  dinner: 3,
  snack: 4,
  snacks: 4,
};

const TYPE_REGULAR = 1;
const TYPE_QUICK_ADD = 2;

const MICRONUTRIENT_FIELDS = [
  { prop: "calciumMg", foodProp: "calcium", aliases: ["calciumMg", "CalciumMg", "calcium", "Calcium"] },
  { prop: "ironMg", foodProp: "iron", aliases: ["ironMg", "IronMg", "iron", "Iron"] },
  { prop: "magnesiumMg", foodProp: "magnesium", aliases: ["magnesiumMg", "MagnesiumMg", "magnesium", "Magnesium"] },
  { prop: "phosphorusMg", foodProp: "phosphorus", aliases: ["phosphorusMg", "PhosphorusMg", "phosphorus", "Phosphorus"] },
  { prop: "zincMg", foodProp: "zinc", aliases: ["zincMg", "ZincMg", "zinc", "Zinc"] },
  { prop: "vitaminAUg", foodProp: "vitaminA", aliases: ["vitaminAUg", "VitaminAUg", "vitaminA", "VitaminA"] },
  { prop: "vitaminCMg", foodProp: "vitaminC", aliases: ["vitaminCMg", "VitaminCMg", "vitaminC", "VitaminC"] },
  { prop: "vitaminDUg", foodProp: "vitaminD", aliases: ["vitaminDUg", "VitaminDUg", "vitaminD", "VitaminD"] },
  { prop: "vitaminEMg", foodProp: "vitaminE", aliases: ["vitaminEMg", "VitaminEMg", "vitaminE", "VitaminE"] },
  { prop: "vitaminKUg", foodProp: "vitaminK", aliases: ["vitaminKUg", "VitaminKUg", "vitaminK", "VitaminK"] },
  { prop: "vitaminB6Mg", foodProp: "vitaminB6", aliases: ["vitaminB6Mg", "VitaminB6Mg", "vitaminB6", "VitaminB6"] },
  { prop: "vitaminB12Ug", foodProp: "vitaminB12", aliases: ["vitaminB12Ug", "VitaminB12Ug", "vitaminB12", "VitaminB12"] },
  { prop: "folateDfeUg", foodProp: "folateDfe", aliases: ["folateDfeUg", "FolateDfeUg", "folateDfe", "FolateDfe"] },
] as const;

type MicronutrientLogProp = (typeof MICRONUTRIENT_FIELDS)[number]["prop"];
type MicronutrientFoodProp = (typeof MICRONUTRIENT_FIELDS)[number]["foodProp"];

@Injectable()
export class LogFoodService {
  private readonly logger = new Logger(LogFoodService.name);

  constructor(
    @InjectRepository(LogFoodEntity)
    private readonly logRepo: Repository<LogFoodEntity>,
    @InjectRepository(FoodNutritionEntity)
    private readonly foodRepo: Repository<FoodNutritionEntity>,
    @InjectRepository(MealEntity)
    private readonly mealRepo: Repository<MealEntity>,
  ) {}

  mealSlugToInt(meal: string): number {
    const key = (meal || "").trim().toLowerCase();
    return MEAL_SLUG_TO_INT[key] ?? 1;
  }

  mealIntToSlug(meal: number): string {
    switch (meal) {
      case 2:
        return "lunch";
      case 3:
        return "dinner";
      case 4:
        return "snack";
      default:
        return "breakfast";
    }
  }

  mealIntToMealTypeEnum(meal: number): LogFoodMealTypeEnum {
    switch (meal) {
      case 2:
        return LogFoodMealTypeEnum.lunch;
      case 3:
        return LogFoodMealTypeEnum.dinner;
      case 4:
        return LogFoodMealTypeEnum.snack;
      default:
        return LogFoodMealTypeEnum.breakfast;
    }
  }

  private numToNumericString(v: number): string {
    const n = Number.isFinite(v) ? v : 0;
    return String(Math.round(n * 100) / 100);
  }

  private micronutrientsToApi(row: LogFoodEntity): Record<MicronutrientLogProp, number> {
    const out = {} as Record<MicronutrientLogProp, number>;
    for (const { prop } of MICRONUTRIENT_FIELDS) {
      const raw = row[prop as keyof LogFoodEntity];
      out[prop] = raw != null ? Number(raw) : 0;
    }
    return out;
  }

  private foodMicronutrientsToApi(
    food: FoodNutritionEntity,
  ): Record<MicronutrientLogProp, number | null> {
    const out = {} as Record<MicronutrientLogProp, number | null>;
    for (const { prop, foodProp } of MICRONUTRIENT_FIELDS) {
      const raw = food[foodProp];
      out[prop] = raw != null ? Number(raw) : null;
    }
    return out;
  }

  private scaledFoodMicronutrients(
    food: FoodNutritionEntity,
    factor: number,
  ): Record<MicronutrientLogProp, string> {
    const out = {} as Record<MicronutrientLogProp, string>;
    for (const { prop, foodProp } of MICRONUTRIENT_FIELDS) {
      out[prop] = this.numToNumericString(Number(food[foodProp] ?? 0) * factor);
    }
    return out;
  }

  private parseOptionalFk(dto: CreateLogFoodDto, ...keys: (keyof CreateLogFoodDto)[]): number | null {
    for (const k of keys) {
      const v = dto[k];
      if (v == null || v === "") continue;
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return Math.trunc(n);
    }
    return null;
  }

  private resolveLoggedAt(dto: CreateLogFoodDto): Date {
    const loggedOn = dto.loggedOn?.slice(0, 10) ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(loggedOn)) {
      return new Date(`${loggedOn}T12:00:00.000Z`);
    }
    return dto.LoggedAt ? new Date(dto.LoggedAt) : new Date();
  }

  async create(userId: number, dto: CreateLogFoodDto): Promise<{ id: number }> {
    const typeRaw = (dto.type ?? "regular").toLowerCase();
    const isQuick = typeRaw === "quickadd" || typeRaw === "quick_add";

    const loggedAt = this.resolveLoggedAt(dto);

    const mealSlug = dto.meal;
    const meal = this.mealSlugToInt(mealSlug);
    const mealIdFk = this.parseOptionalFk(dto, "mealId");
    const recipeIdFk = this.parseOptionalFk(dto, "recipeId");

    if (isQuick) {
      const foodNameQuick = (dto.foodName ?? "Quick add").trim() || "Quick add";

      const row = this.logRepo.create({
        userId,
        foodId: null,
        foodName: foodNameQuick,
        mealId: mealIdFk,
        recipeId: recipeIdFk,
        loggedAt,
        meal,
        mealType: this.mealIntToMealTypeEnum(meal),
        type: TYPE_QUICK_ADD,
        numberOfServings: "1",
        servingSize: null,
        unit: null,
        calories: this.numToNumericString(dto.calories ?? 0),
        totalFatG: this.numToNumericString(dto.totalFatG ?? 0),
        totalCarbohydratesG: this.numToNumericString(dto.totalCarbohydratesG ?? 0),
        proteinG: this.numToNumericString(dto.proteinG ?? 0),
        sodiumMg: this.numToNumericString(dto.sodiumMg ?? 0),
        dietaryFibersG: this.numToNumericString(dto.dietaryFibersG ?? 0),
        sugarsG: this.numToNumericString(dto.sugarsG ?? 0),
        saturatedFatG: this.numToNumericString(dto.saturatedFatG ?? 0),
        cholesterolMg: this.numToNumericString(dto.cholesterolMg ?? 0),
        potassiumMg: this.numToNumericString(dto.potassiumMg ?? 0),
        calciumMg: this.numToNumericString(dto.calciumMg ?? 0),
        ironMg: this.numToNumericString(dto.ironMg ?? 0),
        magnesiumMg: this.numToNumericString(dto.magnesiumMg ?? 0),
        phosphorusMg: this.numToNumericString(dto.phosphorusMg ?? 0),
        zincMg: this.numToNumericString(dto.zincMg ?? 0),
        vitaminAUg: this.numToNumericString(dto.vitaminAUg ?? 0),
        vitaminCMg: this.numToNumericString(dto.vitaminCMg ?? 0),
        vitaminDUg: this.numToNumericString(dto.vitaminDUg ?? 0),
        vitaminEMg: this.numToNumericString(dto.vitaminEMg ?? 0),
        vitaminKUg: this.numToNumericString(dto.vitaminKUg ?? 0),
        vitaminB6Mg: this.numToNumericString(dto.vitaminB6Mg ?? 0),
        vitaminB12Ug: this.numToNumericString(dto.vitaminB12Ug ?? 0),
        folateDfeUg: this.numToNumericString(dto.folateDfeUg ?? 0),
        delFlag: false,
      });
      const saved = await this.logRepo.save(row);
      return { id: Number(saved.id) };
    }

    const hasValidFoodId = dto.foodId != null && dto.foodId > 0;

    /** Regular (type 1) log from a saved meal template: no Food row, snapshot macros + MealId. */
    if (!hasValidFoodId && mealIdFk != null) {
      const mealRow = await this.mealRepo
        .createQueryBuilder("m")
        .where("m.id = :mealId", { mealId: mealIdFk })
        .andWhere("m.delFlag = false")
        .andWhere("(m.userId = :userId OR m.shareWith = 2)", { userId })
        .getOne();
      if (!mealRow) {
        throw new NotFoundException({ errorKey: "logFood.errors.mealNotFound", message: "Meal not found" });
      }
      const foodNameSnap = (dto.foodName ?? mealRow.name ?? "Meal").trim() || mealRow.name;
      const numberOfServings = dto.numberOfServings ?? 1;
      const servingSize = dto.servingSize ?? 1;

      const row = this.logRepo.create({
        userId,
        foodId: null,
        foodName: foodNameSnap,
        mealId: mealIdFk,
        recipeId: recipeIdFk,
        loggedAt,
        meal,
        mealType: this.mealIntToMealTypeEnum(meal),
        type: TYPE_REGULAR,
        numberOfServings: this.numToNumericString(Math.max(numberOfServings, 1)),
        servingSize: this.numToNumericString(servingSize),
        unit: dto.unit?.trim() || "meal",
        calories: this.numToNumericString(dto.calories ?? 0),
        totalFatG: this.numToNumericString(dto.totalFatG ?? 0),
        totalCarbohydratesG: this.numToNumericString(dto.totalCarbohydratesG ?? 0),
        proteinG: this.numToNumericString(dto.proteinG ?? 0),
        sodiumMg: this.numToNumericString(dto.sodiumMg ?? 0),
        dietaryFibersG: this.numToNumericString(dto.dietaryFibersG ?? 0),
        sugarsG: this.numToNumericString(dto.sugarsG ?? 0),
        saturatedFatG: this.numToNumericString(dto.saturatedFatG ?? 0),
        cholesterolMg: this.numToNumericString(dto.cholesterolMg ?? 0),
        potassiumMg: this.numToNumericString(dto.potassiumMg ?? 0),
        calciumMg: this.numToNumericString(dto.calciumMg ?? 0),
        ironMg: this.numToNumericString(dto.ironMg ?? 0),
        magnesiumMg: this.numToNumericString(dto.magnesiumMg ?? 0),
        phosphorusMg: this.numToNumericString(dto.phosphorusMg ?? 0),
        zincMg: this.numToNumericString(dto.zincMg ?? 0),
        vitaminAUg: this.numToNumericString(dto.vitaminAUg ?? 0),
        vitaminCMg: this.numToNumericString(dto.vitaminCMg ?? 0),
        vitaminDUg: this.numToNumericString(dto.vitaminDUg ?? 0),
        vitaminEMg: this.numToNumericString(dto.vitaminEMg ?? 0),
        vitaminKUg: this.numToNumericString(dto.vitaminKUg ?? 0),
        vitaminB6Mg: this.numToNumericString(dto.vitaminB6Mg ?? 0),
        vitaminB12Ug: this.numToNumericString(dto.vitaminB12Ug ?? 0),
        folateDfeUg: this.numToNumericString(dto.folateDfeUg ?? 0),
        delFlag: false,
      });
      const saved = await this.logRepo.save(row);
      return { id: Number(saved.id) };
    }

    if (!hasValidFoodId) {
      throw new BadRequestException({ errorKey: "logFood.errors.foodIdRequired", message: "foodId is required for regular logs" });
    }

    const food = await this.foodRepo.findOne({ where: { id: dto.foodId, delFlag: false } });
    if (!food) {
      throw new NotFoundException({ errorKey: "logFood.errors.foodNotFound", message: "Food not found" });
    }

    const numberOfServings = dto.numberOfServings ?? 1;
    const servingSize = dto.servingSize ?? Number(food.servingSize ?? 100);
    const base = Math.max(Number(food.servingSize || 100), 0.001);
    const factor = (Number.isFinite(numberOfServings) ? numberOfServings : 1) * (Number.isFinite(servingSize) && servingSize > 0 ? servingSize / base : 1);

    const foodNameSnapshot = (food.foodName || "").trim() || "Food";

    const row = this.logRepo.create({
      userId,
      foodId: dto.foodId,
      foodName: foodNameSnapshot,
      mealId: mealIdFk,
      recipeId: recipeIdFk,
      loggedAt,
      meal,
      mealType: this.mealIntToMealTypeEnum(meal),
      type: TYPE_REGULAR,
      numberOfServings: this.numToNumericString(numberOfServings),
      servingSize: servingSize != null ? this.numToNumericString(servingSize) : null,
      unit: dto.unit?.trim() || food.servingUnit || null,
      calories: this.numToNumericString(Number(food.calories ?? 0) * factor),
      totalFatG: this.numToNumericString(Number(food.fat ?? 0) * factor),
      totalCarbohydratesG: this.numToNumericString(Number(food.carbs ?? 0) * factor),
      proteinG: this.numToNumericString(Number(food.protein ?? 0) * factor),
      sodiumMg: this.numToNumericString(Number(food.sodium ?? 0) * factor),
      dietaryFibersG: this.numToNumericString(Number(food.fiber ?? 0) * factor),
      sugarsG: this.numToNumericString(Number(food.sugars ?? 0) * factor),
      saturatedFatG: this.numToNumericString(Number(food.saturatedFat ?? 0) * factor),
      cholesterolMg: this.numToNumericString(Number(food.cholesterol ?? 0) * factor),
      potassiumMg: this.numToNumericString(Number(food.potassium ?? 0) * factor),
      ...this.scaledFoodMicronutrients(food, factor),
      delFlag: false,
    });
    const saved = await this.logRepo.save(row);
    return { id: Number(saved.id) };
  }

  async list(
    userId: number,
    startDate: string,
    endDate: string,
    page = 1,
    pageSize = 500,
    includeQuickAdd = false,
    tzOffsetMinutes = 0,
  ): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }> {
    try {
      const start = this.parseDayStart(startDate, tzOffsetMinutes);
      const end = this.parseDayEnd(endDate, tzOffsetMinutes);
      const take = Math.min(Math.max(pageSize, 1), 500);
      const skip = (Math.max(page, 1) - 1) * take;
      const query = this.logRepo
        .createQueryBuilder("log")
        .leftJoin(MealEntity, "meal", "meal.id = log.mealId")
        .where("log.userId = :userId", { userId })
        .andWhere("log.delFlag = false")
        .andWhere("log.loggedAt BETWEEN :start AND :end", { start, end })
        .orderBy("log.loggedAt", "DESC")
        .addOrderBy("log.id", "DESC")
        .skip(skip)
        .take(take);

      if (!includeQuickAdd) {
        query.andWhere("log.type != :quickType", { quickType: TYPE_QUICK_ADD });
      }

      const [rows, total] = await query.getManyAndCount();

      const items = await this.mapRowsToApiItems(rows);
      return { items, total, page: Math.max(page, 1), pageSize: take };
    } catch (e) {
      this.logger.error(`list LogFood failed userId=${userId}: ${(e as Error).message}`, (e as Error).stack);
      throw e;
    }
  }

  async mapRowsToApiItems(rows: LogFoodEntity[]): Promise<Record<string, unknown>[]> {
    const ids = [
      ...new Set(
        rows
          .map((r) => r.foodId)
          .filter((id): id is number => id != null && Number(id) > 0)
          .map((id) => Number(id)),
      ),
    ];
    const foods = ids.length > 0 ? await this.foodRepo.find({ where: { id: In(ids), delFlag: false } }) : [];
    const byId = new Map(foods.map((f) => [Number(f.id), f]));
    return rows.map((r) => this.toApiItem(r, r.foodId != null ? byId.get(Number(r.foodId)) ?? null : null));
  }

  async softDelete(userId: number, id: number): Promise<void> {
    const row = await this.logRepo.findOne({ where: { id, userId, delFlag: false } });
    if (!row) {
      throw new NotFoundException({ errorKey: "logFood.errors.notFound", message: "Log entry not found" });
    }
    row.delFlag = true;
    row.updatedAt = new Date();
    await this.logRepo.save(row);
  }

  private normalizeDateKey(s: string): string {
    const raw = (s || "").trim();
    const d = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return d;
    }
    if (raw.length >= 10) {
      try {
        return new Date(raw).toISOString().slice(0, 10);
      } catch {
        /* fall through */
      }
    }
    return new Date().toISOString().slice(0, 10);
  }

  private parseDayStart(s: string, tzOffsetMinutes = 0): Date {
    const d = this.normalizeDateKey(s);
    return calendarDayBounds(d, tzOffsetMinutes).start;
  }

  private parseDayEnd(s: string, tzOffsetMinutes = 0): Date {
    const d = this.normalizeDateKey(s);
    return calendarDayBounds(d, tzOffsetMinutes).end;
  }

  toApiItem(r: LogFoodEntity, resolvedFood?: FoodNutritionEntity | null): Record<string, unknown> {
    const iso = r.loggedAt instanceof Date ? r.loggedAt.toISOString() : new Date(r.loggedAt).toISOString();
    const food = resolvedFood !== undefined ? resolvedFood : null;
    return {
      id: Number(r.id),
      foodId: r.foodId != null ? Number(r.foodId) : null,
      foodName: r.foodName ?? "",
      mealId: r.mealId != null ? Number(r.mealId) : null,
      recipeId: r.recipeId != null ? Number(r.recipeId) : null,
      logType: Number(r.type),
      loggedAt: iso,
      LoggedAt: iso,
      meal: this.mealIntToSlug(r.meal),
      mealType: r.mealType,
      numberOfServings: Number(r.numberOfServings),
      servingSize: r.servingSize != null ? Number(r.servingSize) : null,
      unit: r.unit,
      calories: Number(r.calories),
      totalCarbohydratesG: r.totalCarbohydratesG != null ? Number(r.totalCarbohydratesG) : 0,
      proteinG: r.proteinG != null ? Number(r.proteinG) : 0,
      totalFatG: r.totalFatG != null ? Number(r.totalFatG) : 0,
      sodiumMg: r.sodiumMg != null ? Number(r.sodiumMg) : 0,
      dietaryFibersG: r.dietaryFibersG != null ? Number(r.dietaryFibersG) : 0,
      sugarsG: r.sugarsG != null ? Number(r.sugarsG) : 0,
      saturatedFatG: r.saturatedFatG != null ? Number(r.saturatedFatG) : 0,
      cholesterolMg: r.cholesterolMg != null ? Number(r.cholesterolMg) : 0,
      potassiumMg: r.potassiumMg != null ? Number(r.potassiumMg) : 0,
      ...this.micronutrientsToApi(r),
      isVerified: food ? Boolean(food.isVerified) : false,
      food: food
        ? {
            id: Number(food.id),
            description: food.foodName,
            brandName: food.category ?? "",
            servingUnit: food.servingUnit,
            servingSize: food.servingSize,
            saturatedFatG: food.saturatedFat != null ? Number(food.saturatedFat) : null,
            cholesterolMg: food.cholesterol != null ? Number(food.cholesterol) : null,
            sugarsG: food.sugars != null ? Number(food.sugars) : null,
            potassiumMg: food.potassium != null ? Number(food.potassium) : null,
            ...this.foodMicronutrientsToApi(food),
            isVerified: Boolean(food.isVerified),
          }
        : null,
      loggedMeal: null,
      loggedRecipe: null,
    };
  }
}
