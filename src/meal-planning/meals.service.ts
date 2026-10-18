import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { MealEntity } from "./entities/meal.entity";
import { MealFoodEntity } from "./entities/meal-food.entity";
import { FoodNutritionEntity } from "./entities/food-nutrition.entity";
import { AddMealItemDto, CopyPreviousMealDto, CreateMealDto, UpdateMealDto, UpdateMealItemDto } from "./dto/meal.dto";

/** ~9 kcal/g fat; caps impossible line totals from corrupt Food rows or wrong quantity. */
const MEAL_LINE_MAX_KCAL_PER_GRAM = 9.5;

@Injectable()
export class MealsService {
  constructor(
    @InjectRepository(MealEntity) private readonly mealRepo: Repository<MealEntity>,
    @InjectRepository(MealFoodEntity) private readonly mealFoodRepo: Repository<MealFoodEntity>,
    @InjectRepository(FoodNutritionEntity) private readonly foodRepo: Repository<FoodNutritionEntity>,
  ) {}

  private num(v: string | number | null | undefined): number {
    if (v == null) return 0;
    return Number(v) || 0;
  }

  /** kcal / serving: DB [Calories], hoặc ước lượng từ macro nếu thiếu hoặc 0 (4/9/4). */
  private caloriesPerServing(food: FoodNutritionEntity | undefined): number {
    if (!food) return 0;
    const fromDb = Number(food.calories);
    if (Number.isFinite(fromDb) && fromDb > 0) return fromDb;
    const carbs = Number(food.carbs ?? 0);
    const fat = Number(food.fat ?? 0);
    const protein = Number(food.protein ?? 0);
    return carbs * 4 + fat * 9 + protein * 4;
  }

  private async assertMealOwner(userId: number, mealId: number): Promise<MealEntity> {
    const meal = await this.mealRepo.findOne({ where: { id: mealId, userId, delFlag: false } });
    if (!meal) throw new NotFoundException("Meal not found");
    return meal;
  }

  private async assertMealReadable(userId: number, mealId: number): Promise<MealEntity> {
    const meal = await this.mealRepo
      .createQueryBuilder("m")
      .where("m.id = :mealId", { mealId })
      .andWhere("m.delFlag = false")
      .andWhere("(m.userId = :userId OR m.shareWith = 2)", { userId })
      .getOne();
    if (!meal) throw new NotFoundException("Meal not found");
    return meal;
  }

  async list(userId: number, search?: string, includeCommunity = false, page = 1, pageSize = 50) {
    const qb = this.mealRepo
      .createQueryBuilder("m")
      .where("m.delFlag = false");
    if (includeCommunity) {
      qb.andWhere("(m.userId = :userId OR m.shareWith = 2)", { userId });
    } else {
      qb.andWhere("m.userId = :userId", { userId });
    }
    if (search?.trim()) {
      qb.andWhere(`m.name ILIKE :q`, { q: `%${search.trim()}%` });
    }
    qb.orderBy("m.createdAt", "DESC");
    const total = await qb.getCount();

    qb.skip((page - 1) * pageSize).take(pageSize);
    const meals = await qb.getMany();

    if (meals.length === 0) return { items: [], total };

    const mealIds = meals.map(m => Number(m.id));
    const allMealItems = await this.mealFoodRepo.find({
      where: { mealId: In(mealIds) },
      order: { order: "ASC", id: "ASC" },
    });

    const foodIds = [...new Set(allMealItems.map((i) => Number(i.foodId)).filter((v) => Number.isFinite(v) && v > 0))];
    const foods = foodIds.length ? await this.foodRepo.find({ where: { id: In(foodIds as any) } }) : [];
    const foodMap = new Map(foods.map((f) => [Number(f.id), f]));

    const details = meals.map(meal => {
      const mealItems = allMealItems.filter(i => Number(i.mealId) === Number(meal.id));
      return this._buildMealDetail(meal, mealItems, foodMap);
    });

    return { items: details, total };
  }

  async getById(userId: number, mealId: number) {
    const meal = await this.assertMealReadable(userId, mealId);
    const mealItems = await this.mealFoodRepo.find({
      where: { mealId },
      order: { order: "ASC", id: "ASC" },
    });
    const foodIds = [...new Set(mealItems.map((i) => Number(i.foodId)).filter((v) => Number.isFinite(v) && v > 0))];
    const foods = foodIds.length ? await this.foodRepo.find({ where: { id: In(foodIds as any) } }) : [];
    const foodMap = new Map(foods.map((f) => [Number(f.id), f]));
    return this._buildMealDetail(meal, mealItems, foodMap);
  }

  private _buildMealDetail(meal: MealEntity, mealItems: MealFoodEntity[], foodMap: Map<number, FoodNutritionEntity>) {
    let totalCalories = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let totalProtein = 0;
    let totalFiber = 0;
    let totalSugar = 0;
    let totalSaturatedFat = 0;
    let totalCholesterol = 0;
    let totalSodium = 0;
    let totalPotassium = 0;
    const microTotals = {
      calcium: 0,
      iron: 0,
      magnesium: 0,
      phosphorus: 0,
      zinc: 0,
      vitaminA: 0,
      vitaminC: 0,
      vitaminD: 0,
      vitaminE: 0,
      vitaminK: 0,
      vitaminB6: 0,
      vitaminB12: 0,
      folateDfe: 0,
    };

    const items = mealItems.map((i) => {
      const food = foodMap.get(Number(i.foodId));
      const qty = this.num(i.quantity) || 1;
      let calories = this.caloriesPerServing(food) * qty;
      let carbs = (food?.carbs ?? 0) * qty;
      let fat = (food?.fat ?? 0) * qty;
      let protein = (food?.protein ?? 0) * qty;
      let fiber = (food?.fiber ?? 0) * qty;
      let sugar = (food?.sugars ?? 0) * qty;
      let saturatedFat = (food?.saturatedFat ?? 0) * qty;
      let cholesterol = (food?.cholesterol ?? 0) * qty;
      let sodium = (food?.sodium ?? 0) * qty;
      let potassium = (food?.potassium ?? 0) * qty;
      const micro = {
        calcium: (food?.calcium ?? 0) * qty,
        iron: (food?.iron ?? 0) * qty,
        magnesium: (food?.magnesium ?? 0) * qty,
        phosphorus: (food?.phosphorus ?? 0) * qty,
        zinc: (food?.zinc ?? 0) * qty,
        vitaminA: (food?.vitaminA ?? 0) * qty,
        vitaminC: (food?.vitaminC ?? 0) * qty,
        vitaminD: (food?.vitaminD ?? 0) * qty,
        vitaminE: (food?.vitaminE ?? 0) * qty,
        vitaminK: (food?.vitaminK ?? 0) * qty,
        vitaminB6: (food?.vitaminB6 ?? 0) * qty,
        vitaminB12: (food?.vitaminB12 ?? 0) * qty,
        folateDfe: (food?.folateDfe ?? 0) * qty,
      };
      const servingG = food && food.servingSize > 0 ? food.servingSize : 100;
      const estGrams = qty * servingG;
      const maxKcal = estGrams * MEAL_LINE_MAX_KCAL_PER_GRAM;
      if (maxKcal > 0 && calories > maxKcal) {
        const s = maxKcal / calories;
        calories = maxKcal;
        carbs *= s;
        fat *= s;
        protein *= s;
        fiber *= s;
        sugar *= s;
        saturatedFat *= s;
        cholesterol *= s;
        sodium *= s;
        potassium *= s;
        for (const key of Object.keys(micro) as Array<keyof typeof micro>) {
          micro[key] *= s;
        }
      }
      totalCalories += calories;
      totalCarbs += carbs;
      totalFat += fat;
      totalProtein += protein;
      totalFiber += fiber;
      totalSugar += sugar;
      totalSaturatedFat += saturatedFat;
      totalCholesterol += cholesterol;
      totalSodium += sodium;
      totalPotassium += potassium;
      for (const key of Object.keys(microTotals) as Array<keyof typeof microTotals>) {
        microTotals[key] += micro[key];
      }
      return {
        id: Number(i.id),
        mealFoodId: Number(i.id),
        foodId: Number(i.foodId),
        quantity: qty,
        order: Number(i.order ?? 0),
        unit: i.unit ?? food?.servingUnit ?? null,
        calories,
        food: food
          ? {
              id: Number(food.id),
              foodName: food.foodName,
              description: food.foodName,
              brandName: food.category ?? "",
              servingSize: food.servingSize,
              servingUnit: food.servingUnit,
              calories: this.caloriesPerServing(food),
              proteinG: food.protein ?? null,
              totalCarbohydratesG: food.carbs ?? null,
              totalFatG: food.fat ?? null,
              dietaryFibersG: food.fiber ?? null,
              sodiumMg: food.sodium ?? null,
              saturatedFatG: food.saturatedFat ?? null,
              cholesterolMg: food.cholesterol ?? null,
              sugarsG: food.sugars ?? null,
              potassiumMg: food.potassium ?? null,
              calciumMg: food.calcium ?? null,
              ironMg: food.iron ?? null,
              magnesiumMg: food.magnesium ?? null,
              phosphorusMg: food.phosphorus ?? null,
              zincMg: food.zinc ?? null,
              vitaminAUg: food.vitaminA ?? null,
              vitaminCMg: food.vitaminC ?? null,
              vitaminDUg: food.vitaminD ?? null,
              vitaminEMg: food.vitaminE ?? null,
              vitaminKUg: food.vitaminK ?? null,
              vitaminB6Mg: food.vitaminB6 ?? null,
              vitaminB12Ug: food.vitaminB12 ?? null,
              folateDfeUg: food.folateDfe ?? null,
              isVerified: Boolean(food.isVerified),
            }
          : null,
      };
    });

    return {
      id: Number(meal.id),
      name: meal.name,
      shareWith: Number(meal.shareWith ?? 1),
      directions: meal.directions,
      imageUrl: meal.imageUrl,
      createdAt: meal.createdAt,
      updatedAt: meal.updatedAt,
      nutritionSummary: {
        calories: totalCalories,
        carbs: totalCarbs,
        fat: totalFat,
        protein: totalProtein,
        fiber: totalFiber,
        sugar: totalSugar,
        saturatedFat: totalSaturatedFat,
        cholesterol: totalCholesterol,
        sodium: totalSodium,
        potassium: totalPotassium,
        calcium: microTotals.calcium,
        iron: microTotals.iron,
        magnesium: microTotals.magnesium,
        phosphorus: microTotals.phosphorus,
        zinc: microTotals.zinc,
        vitaminA: microTotals.vitaminA,
        vitaminC: microTotals.vitaminC,
        vitaminD: microTotals.vitaminD,
        vitaminE: microTotals.vitaminE,
        vitaminK: microTotals.vitaminK,
        vitaminB6: microTotals.vitaminB6,
        vitaminB12: microTotals.vitaminB12,
        folateDfe: microTotals.folateDfe,
      },
      items,
      itemCount: items.length,
    };
  }

  async create(userId: number, dto: CreateMealDto) {
    const meal = this.mealRepo.create({
      userId,
      name: dto.name.trim(),
      shareWith: dto.shareWith ?? 1,
      directions: dto.directions ?? null,
      imageUrl: dto.imageUrl ?? null,
      delFlag: false,
    });
    const saved = await this.mealRepo.save(meal);
    return this.getById(userId, Number(saved.id));
  }

  async update(userId: number, mealId: number, dto: UpdateMealDto) {
    const meal = await this.assertMealOwner(userId, mealId);
    if (dto.name != null) meal.name = dto.name.trim();
    if (dto.shareWith != null) meal.shareWith = dto.shareWith;
    if (dto.directions !== undefined) meal.directions = dto.directions ?? null;
    if (dto.imageUrl !== undefined) meal.imageUrl = dto.imageUrl ?? null;
    await this.mealRepo.save(meal);
    return this.getById(userId, mealId);
  }

  async remove(userId: number, mealId: number) {
    const meal = await this.assertMealOwner(userId, mealId);
    meal.delFlag = true;
    await this.mealRepo.save(meal);
    return { message: "OK", statusCode: 200 };
  }

  async addItem(userId: number, mealId: number, dto: AddMealItemDto) {
    await this.assertMealOwner(userId, mealId);
    const row = this.mealFoodRepo.create({
      mealId,
      foodId: dto.foodId,
      quantity: String(dto.quantity ?? 1),
      order: dto.order ?? 0,
      unit: dto.unit ?? null,
    });
    await this.mealFoodRepo.save(row);
    return this.getById(userId, mealId);
  }

  async updateItem(userId: number, mealId: number, mealFoodId: number, dto: UpdateMealItemDto) {
    await this.assertMealOwner(userId, mealId);
    const row = await this.mealFoodRepo.findOne({ where: { id: mealFoodId, mealId } });
    if (!row) throw new NotFoundException("Meal item not found");
    if (dto.quantity != null) row.quantity = String(dto.quantity);
    if (dto.order != null) row.order = dto.order;
    if (dto.unit !== undefined) row.unit = dto.unit ?? null;
    await this.mealFoodRepo.save(row);
    return this.getById(userId, mealId);
  }

  async removeItem(userId: number, mealId: number, mealFoodId: number) {
    await this.assertMealOwner(userId, mealId);
    await this.mealFoodRepo.delete({ id: mealFoodId, mealId });
    return this.getById(userId, mealId);
  }

  async copyPrevious(userId: number, dto: CopyPreviousMealDto) {
    let source: MealEntity | null = null;
    if (dto.sourceMealId) {
      source = await this.mealRepo.findOne({ where: { id: dto.sourceMealId, userId, delFlag: false } });
    } else {
      source = await this.mealRepo.findOne({
        where: { userId, delFlag: false },
        order: { createdAt: "DESC", id: "DESC" },
      });
    }
    if (!source) throw new NotFoundException("No previous meal found");
    const sourceItems = await this.mealFoodRepo.find({ where: { mealId: Number(source.id) }, order: { order: "ASC", id: "ASC" } });
    const created = await this.create(userId, { name: dto.name, shareWith: source.shareWith, directions: source.directions ?? undefined, imageUrl: source.imageUrl ?? undefined });
    const newMealId = Number(created.id);
    for (const item of sourceItems) {
      await this.mealFoodRepo.save(
        this.mealFoodRepo.create({
          mealId: newMealId,
          foodId: Number(item.foodId),
          quantity: item.quantity,
          order: item.order,
          unit: item.unit,
        }),
      );
    }
    return this.getById(userId, newMealId);
  }
}
