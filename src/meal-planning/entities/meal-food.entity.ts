import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "MealFood" })
export class MealFoodEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "MealId" })
  mealId!: number;

  @Column({ type: "bigint", name: "FoodId" })
  foodId!: number;

  @Column({ type: "numeric", name: "Quantity", precision: 10, scale: 2, default: 1 })
  quantity!: string;

  @Column({ type: "integer", name: "Order", default: 0 })
  order!: number;

  @Column({ type: "text", name: "Unit", nullable: true })
  unit!: string | null;
}
