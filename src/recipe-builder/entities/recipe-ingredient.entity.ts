import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "RecipeIngredient" })
export class RecipeIngredientEntity {
  @PrimaryColumn({ type: "bigint", name: "RecipeId" })
  recipeId!: number;

  @PrimaryColumn({ type: "integer", name: "Position" })
  position!: number;

  @Column({ type: "text", name: "QuantityRaw", nullable: true })
  quantityRaw!: string | null;
}
