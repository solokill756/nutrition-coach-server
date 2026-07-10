import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";

@Entity({ name: "DailyNutritionSummary" })
export class DailyNutritionSummaryEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @ManyToOne(() => AppUserEntity)
  @JoinColumn({ name: "UserId" })
  user!: AppUserEntity;

  @Column({ type: "date", name: "Date" })
  date!: string;

  @Column({ type: "float", name: "TotalCalories", default: 0 })
  totalCalories!: number;

  @Column({ type: "float", name: "TotalProtein", default: 0 })
  totalProtein!: number;

  @Column({ type: "float", name: "TotalCarbs", default: 0 })
  totalCarbs!: number;

  @Column({ type: "float", name: "TotalFat", default: 0 })
  totalFat!: number;

  @Column({ type: "float", name: "TotalSodium", default: 0 })
  totalSodium!: number;

  @Column({ type: "float", name: "TotalSugar", default: 0 })
  totalSugar!: number;

  @Column({ type: "float", name: "TotalSaturatedFat", default: 0 })
  totalSaturatedFat!: number;

  @Column({ type: "float", name: "TotalCholesterol", default: 0 })
  totalCholesterol!: number;

  @Column({ type: "float", name: "TotalPotassium", default: 0 })
  totalPotassium!: number;

  @Column({ type: "float", name: "TotalCalcium", default: 0 })
  totalCalcium!: number;

  @Column({ type: "float", name: "TotalIron", default: 0 })
  totalIron!: number;

  @Column({ type: "float", name: "TotalMagnesium", default: 0 })
  totalMagnesium!: number;

  @Column({ type: "float", name: "TotalPhosphorus", default: 0 })
  totalPhosphorus!: number;

  @Column({ type: "float", name: "TotalZinc", default: 0 })
  totalZinc!: number;

  @Column({ type: "float", name: "TotalVitaminA", default: 0 })
  totalVitaminA!: number;

  @Column({ type: "float", name: "TotalVitaminC", default: 0 })
  totalVitaminC!: number;

  @Column({ type: "float", name: "TotalVitaminD", default: 0 })
  totalVitaminD!: number;

  @Column({ type: "float", name: "TotalVitaminE", default: 0 })
  totalVitaminE!: number;

  @Column({ type: "float", name: "TotalVitaminK", default: 0 })
  totalVitaminK!: number;

  @Column({ type: "float", name: "TotalVitaminB6", default: 0 })
  totalVitaminB6!: number;

  @Column({ type: "float", name: "TotalVitaminB12", default: 0 })
  totalVitaminB12!: number;

  @Column({ type: "float", name: "TotalFolateDfe", default: 0 })
  totalFolateDfe!: number;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;
}
