import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { UserStapleFoodEntity } from "./entities/user-staple-food.entity";
import { FoodNutritionEntity } from "../meal-planning/entities/food-nutrition.entity";

@Injectable()
export class UserStapleFoodService {
  constructor(
    @InjectRepository(UserStapleFoodEntity)
    private readonly stapleRepo: Repository<UserStapleFoodEntity>,
    @InjectRepository(FoodNutritionEntity)
    private readonly foodRepo: Repository<FoodNutritionEntity>,
  ) {}

  async listWithFood(userId: number): Promise<FoodNutritionEntity[]> {
    const rows = await this.stapleRepo.find({
      where: { userId },
      order: { createdAt: "ASC", id: "ASC" },
    });
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((r) => Number(r.foodId)))];
    const foods = await this.foodRepo.find({ where: { id: In(ids) } });
    const order = new Map(ids.map((id, i) => [id, i]));
    return foods.sort((a, b) => (order.get(Number(a.id)) ?? 0) - (order.get(Number(b.id)) ?? 0));
  }

  async listFoodIds(userId: number): Promise<number[]> {
    const rows = await this.stapleRepo.find({
      where: { userId },
      select: ["foodId"],
      order: { createdAt: "ASC", id: "ASC" },
    });
    return rows.map((r) => Number(r.foodId));
  }

  async add(userId: number, foodId: number): Promise<void> {
    const exists = await this.stapleRepo.findOne({ where: { userId, foodId } });
    if (exists) throw new ConflictException("Food already in staples");
    await this.stapleRepo.save(this.stapleRepo.create({ userId, foodId }));
  }

  async remove(userId: number, foodId: number): Promise<void> {
    const res = await this.stapleRepo.delete({ userId, foodId });
    if (!res.affected) throw new NotFoundException("Staple not found");
  }
}
