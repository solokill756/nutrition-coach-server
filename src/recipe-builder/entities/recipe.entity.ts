import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "Recipe" })
export class RecipeEntity {
  @PrimaryGeneratedColumn({ type: "bigint", name: "Id" })
  id!: number;

  @Column({ type: "bigint", name: "UserId" })
  userId!: number;

  @Column({ type: "text", name: "Title" })
  name!: string;

  @Column({ type: "text", name: "ImageUrl", nullable: true })
  imageUrl!: string | null;

  @Column({ type: "integer", name: "Servings", nullable: true })
  servings!: number;

  @Column({ type: "text", name: "Source", nullable: true })
  source!: string | null;

  @Column({ type: "boolean", name: "DelFlag", default: false })
  delFlag!: boolean;

  @Column({ type: "boolean", name: "IsVerified", default: true })
  isVerified!: boolean;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;
}
