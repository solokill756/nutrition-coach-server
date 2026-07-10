export class AdminRecipeIngredientResponseDto {
  position!: number;
  foodId!: number | null;
  name!: string;
  quantity!: number;
  unit!: string;
  calories!: number;
  protein!: number;
  carbs!: number;
  fat!: number;
}

export class AdminRecipeStepResponseDto {
  order!: number;
  instruction!: string;
  duration!: number | null;
  tips!: string | null;
}

export class AdminRecipeResponseDto {
  id!: number;
  userId!: number;
  title!: string;
  imageUrl!: string | null;
  servings!: number;
  description!: string | null;
  shareWith!: number;
  prepMinutes!: number;
  cookMinutes!: number;
  difficulty!: "easy" | "medium" | "hard";
  tags!: string[];
  sourceType!: string | null;
  dateKey!: string | null;
  mealSlot!: string | null;
  isVerified!: boolean;
  createdAt!: string;
  updatedAt!: string;
}

export class AdminRecipeDetailResponseDto extends AdminRecipeResponseDto {
  ingredients!: AdminRecipeIngredientResponseDto[];
  steps!: AdminRecipeStepResponseDto[];
  sourceMeta!: Record<string, unknown>;
}

export class AdminRecipeListResponseDto {
  success!: true;
  data!: AdminRecipeResponseDto[];
  pagination!: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class AdminRecipeDetailEnvelopeDto {
  success!: true;
  data!: AdminRecipeDetailResponseDto;
}

export class AdminRecipeWriteResponseDto {
  success!: true;
  message!: string;
  data!: {
    id: number;
    title: string;
  };
}

export class AdminRecipeDeleteResponseDto {
  success!: true;
  message!: string;
}

export class AdminRecipeVerifyResponseDto {
  success!: true;
  message!: string;
  data!: {
    id: number;
    isVerified: boolean;
  };
}
