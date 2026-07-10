import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";

@Entity({ name: "UserGoal" })
export class UserGoalEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @ManyToOne(() => AppUserEntity)
  @JoinColumn({ name: "UserId" })
  user!: AppUserEntity;

  @Column({ type: "text", name: "GoalType" })
  goalType!: string; // weight-loss, muscle-gain, maintenance, etc.

  @Column({ type: "float", name: "TargetCalories", nullable: true })
  targetCalories!: number | null;

  @Column({ type: "timestamp with time zone", name: "StartDate" })
  startDate!: Date;

  @Column({ type: "timestamp with time zone", name: "EndDate", nullable: true })
  endDate!: Date | null;

  @Column({ type: "boolean", name: "IsActive", default: true })
  isActive!: boolean;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;
}
