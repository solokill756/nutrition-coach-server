import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "FridgeManualPlanGeneration" })
export class FridgeManualPlanGenerationEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @Column({ type: "varchar", length: 10, name: "DateKey" })
  dateKey!: string;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;
}
