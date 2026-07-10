import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";
import { FoodNutritionEntity } from "../../meal-planning/entities/food-nutrition.entity";

@Entity({ name: "UserStapleFood" })
@Unique("UQ_UserStapleFood_User_Food", ["userId", "foodId"])
export class UserStapleFoodEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @ManyToOne(() => AppUserEntity)
  @JoinColumn({ name: "UserId" })
  user!: AppUserEntity;

  @Column({ type: "bigint", name: "FoodId" })
  foodId!: number;

  @ManyToOne(() => FoodNutritionEntity)
  @JoinColumn({ name: "FoodId" })
  food!: FoodNutritionEntity;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;
}
