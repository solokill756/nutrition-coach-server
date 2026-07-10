import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "ExerciseLog" })
export class ExerciseLogEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @Column({ type: "bigint", name: "ExerciseId" })
  exerciseId!: number;

  @Column({ type: "timestamp with time zone", name: "StartedAt", default: () => "CURRENT_TIMESTAMP" })
  startedAt!: Date;

  @Column({ type: "numeric", name: "MinutesPerformed", nullable: true })
  minutesPerformed!: string | null;

  @Column({ type: "numeric", name: "CaloriesBurned", nullable: true })
  caloriesBurned!: string | null;

  @Column({ type: "text", name: "Source", nullable: true })
  source!: string | null;

  @Column({ type: "timestamp with time zone", name: "CapturedAt", default: () => "CURRENT_TIMESTAMP" })
  capturedAt!: Date;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;

  @Column({ type: "boolean", name: "DelFlag", default: false })
  delFlag!: boolean;
}
