import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";

export enum LogFoodMealTypeEnum {
  breakfast = "breakfast",
  lunch = "lunch",
  dinner = "dinner",
  snack = "snack",
}

@Entity({ name: "LogFood" })
export class LogFoodEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @ManyToOne(() => AppUserEntity)
  @JoinColumn({ name: "UserId" })
  user!: AppUserEntity;

  @Column({ type: "bigint", name: "FoodId", nullable: true })
  foodId!: number | null;

  @Column({ type: "text", name: "FoodName", default: "" })
  foodName!: string;

  @Column({ type: "bigint", name: "MealId", nullable: true })
  mealId!: number | null;

  @Column({ type: "bigint", name: "RecipeId", nullable: true })
  recipeId!: number | null;

  @Column({ type: "timestamp with time zone", name: "LoggedAt" })
  loggedAt!: Date;

  @Column({ type: "smallint", name: "Meal" })
  meal!: number;

  @Column({
    type: "enum",
    enum: LogFoodMealTypeEnum,
    enumName: "MealType",
    name: "MealType",
    default: LogFoodMealTypeEnum.breakfast,
  })
  mealType!: LogFoodMealTypeEnum;

  @Column({ type: "smallint", name: "Type" })
  type!: number;

  @Column({ type: "numeric", name: "NumberOfServings", precision: 10, scale: 2, default: 1 })
  numberOfServings!: string;

  @Column({ type: "numeric", name: "ServingSize", precision: 10, scale: 2, nullable: true })
  servingSize!: string | null;

  @Column({ type: "text", name: "Unit", nullable: true })
  unit!: string | null;

  @Column({ type: "numeric", name: "Calories", precision: 10, scale: 2, default: 0 })
  calories!: string;

  @Column({ type: "numeric", name: "TotalFatG", precision: 10, scale: 2, nullable: true })
  totalFatG!: string | null;

  @Column({ type: "numeric", name: "TotalCarbohydratesG", precision: 10, scale: 2, nullable: true })
  totalCarbohydratesG!: string | null;

  @Column({ type: "numeric", name: "ProteinG", precision: 10, scale: 2, nullable: true })
  proteinG!: string | null;

  /** Snapshot sodium (mg) for this log row; aligned with Food."SodiumMg". */
  @Column({ type: "numeric", name: "SodiumMg", precision: 10, scale: 2, nullable: true })
  sodiumMg!: string | null;

  /** Snapshot dietary fiber (g); aligned with Food."FiberG". */
  @Column({ type: "numeric", name: "DietaryFibersG", precision: 10, scale: 2, nullable: true })
  dietaryFibersG!: string | null;

  /** Snapshot total sugars (g); aligned with Food."SugarsG". */
  @Column({ type: "numeric", name: "SugarsG", precision: 10, scale: 2, nullable: true })
  sugarsG!: string | null;

  /** Snapshot saturated fat (g); aligned with Food."SaturatedFatG". */
  @Column({ type: "numeric", name: "SaturatedFatG", precision: 10, scale: 2, nullable: true })
  saturatedFatG!: string | null;

  /** Snapshot cholesterol (mg); aligned with Food."CholesterolMg". */
  @Column({ type: "numeric", name: "CholesterolMg", precision: 10, scale: 2, nullable: true })
  cholesterolMg!: string | null;

  /** Snapshot potassium (mg); aligned with Food."PotassiumMg". */
  @Column({ type: "numeric", name: "PotassiumMg", precision: 10, scale: 2, nullable: true })
  potassiumMg!: string | null;

  @Column({ type: "numeric", name: "CalciumMg", precision: 10, scale: 2, nullable: true })
  calciumMg!: string | null;

  @Column({ type: "numeric", name: "IronMg", precision: 10, scale: 2, nullable: true })
  ironMg!: string | null;

  @Column({ type: "numeric", name: "MagnesiumMg", precision: 10, scale: 2, nullable: true })
  magnesiumMg!: string | null;

  @Column({ type: "numeric", name: "PhosphorusMg", precision: 10, scale: 2, nullable: true })
  phosphorusMg!: string | null;

  @Column({ type: "numeric", name: "ZincMg", precision: 10, scale: 2, nullable: true })
  zincMg!: string | null;

  @Column({ type: "numeric", name: "VitaminAUg", precision: 10, scale: 2, nullable: true })
  vitaminAUg!: string | null;

  @Column({ type: "numeric", name: "VitaminCMg", precision: 10, scale: 2, nullable: true })
  vitaminCMg!: string | null;

  @Column({ type: "numeric", name: "VitaminDUg", precision: 10, scale: 2, nullable: true })
  vitaminDUg!: string | null;

  @Column({ type: "numeric", name: "VitaminEMg", precision: 10, scale: 2, nullable: true })
  vitaminEMg!: string | null;

  @Column({ type: "numeric", name: "VitaminKUg", precision: 10, scale: 2, nullable: true })
  vitaminKUg!: string | null;

  @Column({ type: "numeric", name: "VitaminB6Mg", precision: 10, scale: 2, nullable: true })
  vitaminB6Mg!: string | null;

  @Column({ type: "numeric", name: "VitaminB12Ug", precision: 10, scale: 2, nullable: true })
  vitaminB12Ug!: string | null;

  @Column({ type: "numeric", name: "FolateDfeUg", precision: 10, scale: 2, nullable: true })
  folateDfeUg!: string | null;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;

  @Column({ type: "boolean", name: "DelFlag", default: false })
  delFlag!: boolean;
}
