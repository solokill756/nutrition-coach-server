import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { AppUserEntity } from "../../auth/entities/app-user.entity";

@Entity({ name: "DailyDiaryStatus" })
export class DailyDiaryStatusEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @ManyToOne(() => AppUserEntity)
  @JoinColumn({ name: "UserId" })
  user!: AppUserEntity;

  @Column({ type: "date", name: "Date" })
  date!: string;

  @Column({ type: "boolean", name: "IsCompleted", default: false })
  isCompleted!: boolean;

  @Column({ type: "text", name: "Note", nullable: true })
  note!: string | null;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;
}
