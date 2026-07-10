import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";

@Entity({ name: "UserNutritionalThreshold" })
export class UserNutritionalThresholdEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @ManyToOne(() => AppUserEntity)
  @JoinColumn({ name: "UserId" })
  user!: AppUserEntity;

  @Column({ type: "text", name: "Nutrient" })
  nutrient!: string; // sodium, carbs, protein, etc.

  @Column({ type: "float", name: "MaxAmount", nullable: true })
  maxAmount!: number | null;

  @Column({ type: "float", name: "MinAmount", nullable: true })
  minAmount!: number | null;

  @Column({ type: "text", name: "Unit", default: "g" })
  unit!: string;

  @Column({ type: "boolean", name: "IsActive", default: true })
  isActive!: boolean;

  @Column({ type: "text", name: "Origin", default: "system" })
  origin!: "system" | "admin_rule" | "user_custom" | "rebalance";

  @Column({ type: "text", name: "SourceConditionKey", nullable: true })
  sourceConditionKey!: string | null;

  @Column({ type: "bigint", name: "SourceRuleId", nullable: true })
  sourceRuleId!: number | null;

  @Column({ type: "boolean", name: "IsCustomized", default: false })
  isCustomized!: boolean;

  @Column({ type: "float", name: "PreviousCustomMinAmount", nullable: true })
  previousCustomMinAmount!: number | null;

  @Column({ type: "float", name: "PreviousCustomMaxAmount", nullable: true })
  previousCustomMaxAmount!: number | null;

  @Column({ type: "text", name: "PreviousCustomUnit", nullable: true })
  previousCustomUnit!: string | null;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;
}
