import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "RecipeStep" })
export class RecipeStepEntity {
  @PrimaryColumn({ type: "bigint", name: "RecipeId" })
  recipeId!: number;

  @PrimaryColumn({ type: "integer", name: "StepNo" })
  stepNo!: number;

  @Column({ type: "text", name: "Instruction" })
  instruction!: string;

  @Column({ type: "integer", name: "DurationMinutes", nullable: true })
  durationMinutes!: number | null;

  @Column({ type: "text", name: "Tips", nullable: true })
  tips!: string | null;

  @Column({ type: "timestamp with time zone", name: "CreatedAt", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ type: "timestamp with time zone", name: "UpdatedAt", default: () => "CURRENT_TIMESTAMP" })
  updatedAt!: Date;

  @Column({ type: "boolean", name: "DelFlag", default: false })
  delFlag!: boolean;
}
