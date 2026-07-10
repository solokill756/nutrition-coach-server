import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "Weight" })
export class WeightEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @Column({ type: "numeric", name: "WeightKg", precision: 5, scale: 2 })
  weightKg!: string;

  @Column({ type: "timestamp with time zone", name: "RecordedAt" })
  recordedAt!: Date;

  @Column({ type: "date", name: "RecordedOn" })
  recordedOn!: string;

  @Column({ type: "varchar", name: "PhotoUrl", length: 255, nullable: true })
  photoUrl!: string | null;

  @Column({ type: "text", name: "Caption", nullable: true })
  caption!: string | null;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;

  @Column({ type: "boolean", name: "DelFlag", default: false })
  delFlag!: boolean;
}
