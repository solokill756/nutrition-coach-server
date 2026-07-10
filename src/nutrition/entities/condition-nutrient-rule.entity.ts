import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

export type ConditionRuleRebalanceMode = "strict" | "auto_rebalance";

@Entity({ name: "ConditionNutrientRule" })
export class ConditionNutrientRuleEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "text", name: "ConditionKey" })
  conditionKey!: string;

  @Column({ type: "text", name: "Nutrient" })
  nutrient!: string;

  @Column({ type: "float", name: "MinAmount", nullable: true })
  minAmount!: number | null;

  @Column({ type: "float", name: "MaxAmount", nullable: true })
  maxAmount!: number | null;

  @Column({ type: "text", name: "Unit" })
  unit!: string;

  @Column({ type: "text", name: "RebalanceMode", default: "strict" })
  rebalanceMode!: ConditionRuleRebalanceMode;

  @Column({ type: "boolean", name: "IsActive", default: true })
  isActive!: boolean;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;
}
