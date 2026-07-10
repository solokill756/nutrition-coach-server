import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

export enum ExerciseType {
  cardio = "cardio",
  strength = "strength",
}

@Entity({ name: "Exercise" })
export class ExerciseEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "text", name: "Name" })
  name!: string;

  @Column({ type: "enum", enum: ExerciseType, enumName: "ExerciseType", name: "Type" })
  type!: ExerciseType;

  @Column({ type: "numeric", name: "Met", nullable: true })
  met!: string | null;

  @Column({ type: "numeric", name: "DefaultCalPerMin", nullable: true })
  defaultCalPerMin!: string | null;

  @Column({ type: "text", name: "Notes", nullable: true })
  notes!: string | null;

  @Column({ type: "boolean", name: "DelFlag", default: false })
  delFlag!: boolean;

  @Column({ type: "boolean", name: "IsVerified", default: true })
  isVerified!: boolean;

  /** Null for admin/catalog exercises; set when a mobile user creates a custom exercise. */
  @Column({ type: "bigint", name: "UserId", nullable: true })
  userId!: number | null;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;
}
