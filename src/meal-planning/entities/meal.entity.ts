import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "Meal" })
export class MealEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @Column({ type: "text", name: "Name" })
  name!: string;

  @Column({ type: "smallint", name: "ShareWith", default: 1 })
  shareWith!: number;

  @Column({ type: "text", name: "Directions", nullable: true })
  directions!: string | null;

  @Column({ type: "text", name: "ImageUrl", nullable: true })
  imageUrl!: string | null;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;

  @Column({ type: "boolean", name: "DelFlag", default: false })
  delFlag!: boolean;
}
