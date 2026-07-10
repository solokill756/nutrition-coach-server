import { ExerciseType } from "../../../exercises/entities/exercise.entity";

export class AdminExerciseResponseDto {
  id!: number;
  name!: string;
  type!: ExerciseType;
  met!: number | null;
  defaultCalPerMin!: number | null;
  notes!: string | null;
  isVerified!: boolean;
  createdAt!: string;
  updatedAt!: string | null;
}

export class AdminExerciseListResponseDto {
  success!: true;
  data!: AdminExerciseResponseDto[];
  pagination!: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class AdminExerciseDetailResponseDto {
  success!: true;
  data!: AdminExerciseResponseDto;
}

export class AdminExerciseWriteResponseDto {
  success!: true;
  message!: string;
  data!: {
    id: number;
    name: string;
  };
}

export class AdminExerciseDeleteResponseDto {
  success!: true;
  message!: string;
}

export class AdminExerciseVerifyResponseDto {
  success!: true;
  message!: string;
  data!: {
    id: number;
    isVerified: boolean;
  };
}
