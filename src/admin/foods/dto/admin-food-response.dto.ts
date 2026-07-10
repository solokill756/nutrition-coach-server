export class AdminFoodResponseDto {
  id!: number;
  foodName!: string;
  servingUnit!: string;
  category!: string | null;
  servingSize!: number;
  calories!: number;
  proteinG!: number;
  totalCarbohydratesG!: number;
  totalFatG!: number;
  fiberG!: number;
  sodiumMg!: number;
  saturatedFatG!: number | null;
  cholesterolMg!: number | null;
  sugarsG!: number | null;
  potassiumMg!: number | null;
  calciumMg!: number | null;
  ironMg!: number | null;
  magnesiumMg!: number | null;
  phosphorusMg!: number | null;
  zincMg!: number | null;
  vitaminAUg!: number | null;
  vitaminCMg!: number | null;
  vitaminDUg!: number | null;
  vitaminEMg!: number | null;
  vitaminKUg!: number | null;
  vitaminB6Mg!: number | null;
  vitaminB12Ug!: number | null;
  folateDfeUg!: number | null;
  isVerified!: boolean;
  createdAt!: string;
  updatedAt!: string;
}

export class AdminFoodDetailResponseDto extends AdminFoodResponseDto {
  userId!: number | null;
}

export class AdminFoodPaginationDto {
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}

export class AdminFoodListResponseDto {
  success!: true;
  data!: AdminFoodResponseDto[];
  pagination!: AdminFoodPaginationDto;
}

export class AdminFoodDetailEnvelopeDto {
  success!: true;
  data!: AdminFoodDetailResponseDto;
}

export class AdminFoodWriteResponseDto {
  success!: true;
  message!: string;
  data!: {
    id: number;
    foodName: string;
  };
}

export class AdminFoodDeleteResponseDto {
  success!: true;
  message!: string;
}

export class AdminFoodVerifyResponseDto {
  success!: true;
  message!: string;
  data!: {
    id: number;
    isVerified: boolean;
  };
}
