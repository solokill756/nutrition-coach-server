import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";

@Entity({ name: "UserHealthCondition" })
export class UserHealthConditionEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @ManyToOne(() => AppUserEntity)
  @JoinColumn({ name: "UserId" })
  user!: AppUserEntity;

  @Column({ type: "text", name: "ConditionName" })
  conditionName!: string; // hypertension, diabetes, etc.

  @Column({ type: "text", name: "Severity", nullable: true })
  severity?: string;

  @Column({ type: "boolean", name: "IsActive", default: true })
  isActive!: boolean;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;
}
