import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

/**
 * Maps the `Food` table. Column names match the **slim** schema used by existing
 * deployments (Category, FiberG, …). `IsVerified` is included; add it with
 * `scripts/sql/patches/food_isverified_all_true.sql` if missing.
 */
@Entity({ name: "Food" })
export class FoodNutritionEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "text", name: "food_name" })
  foodName!: string;

  @Column({ type: "bigint", name: "UserId", nullable: true })
  userId!: number | null;

  @Column({ type: "text", name: "Category", nullable: true })
  category!: string | null;

  @Column({ type: "bigint", name: "FdcId", nullable: true })
  fdcId!: number | null;

  @Column({ type: "float", name: "Calories", default: 0 })
  calories!: number;

  @Column({ type: "float", name: "ProteinG", default: 0 })
  protein!: number;

  @Column({ type: "float", name: "TotalCarbohydratesG", default: 0 })
  carbs!: number;

  @Column({ type: "float", name: "TotalFatG", default: 0 })
  fat!: number;

  @Column({ type: "float", name: "SaturatedFatG", nullable: true })
  saturatedFat!: number | null;

  @Column({ type: "float", name: "CholesterolMg", nullable: true })
  cholesterol!: number | null;

  @Column({ type: "float", name: "FiberG", default: 0 })
  fiber!: number;

  @Column({ type: "float", name: "SugarsG", nullable: true })
  sugars!: number | null;

  @Column({ type: "float", name: "SodiumMg", default: 0 })
  sodium!: number;

  @Column({ type: "float", name: "PotassiumMg", nullable: true })
  potassium!: number | null;

  @Column({ type: "float", name: "CalciumMg", nullable: true })
  calcium!: number | null;

  @Column({ type: "float", name: "IronMg", nullable: true })
  iron!: number | null;

  @Column({ type: "float", name: "MagnesiumMg", nullable: true })
  magnesium!: number | null;

  @Column({ type: "float", name: "PhosphorusMg", nullable: true })
  phosphorus!: number | null;

  @Column({ type: "float", name: "ZincMg", nullable: true })
  zinc!: number | null;

  @Column({ type: "float", name: "VitaminAUg", nullable: true })
  vitaminA!: number | null;

  @Column({ type: "float", name: "VitaminCMg", nullable: true })
  vitaminC!: number | null;

  @Column({ type: "float", name: "VitaminDUg", nullable: true })
  vitaminD!: number | null;

  @Column({ type: "float", name: "VitaminEMg", nullable: true })
  vitaminE!: number | null;

  @Column({ type: "float", name: "VitaminKUg", nullable: true })
  vitaminK!: number | null;

  @Column({ type: "float", name: "VitaminB6Mg", nullable: true })
  vitaminB6!: number | null;

  @Column({ type: "float", name: "VitaminB12Ug", nullable: true })
  vitaminB12!: number | null;

  @Column({ type: "float", name: "FolateDfeUg", nullable: true })
  folateDfe!: number | null;

  @Column({ type: "float", name: "ServingSize", default: 100 })
  servingSize!: number;

  @Column({ type: "text", name: "ServingUnit", default: "g" })
  servingUnit!: string;

  @Column({ type: "float", name: "ServingsPerContainer", default: 1 })
  servingsPerContainer!: number;

  @Column({ type: "boolean", name: "IsVerified", default: false })
  isVerified!: boolean;

  @Column({ type: "boolean", name: "DelFlag", default: false })
  delFlag!: boolean;

  @Column({ type: "timestamp", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP", onUpdate: "CURRENT_TIMESTAMP" })
  updatedAt!: Date;
}
