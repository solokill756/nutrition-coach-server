export class AdminUserResponseDto {
  id!: number;
  email!: string | null;
  displayName!: string;
  avatarUrl!: string | null;
  role!: string;
  status!: number;
  statusLabel!: "active" | "blocked" | "other";
  isActive!: boolean;
  isProfileComplete!: boolean;
  age!: number | null;
  sex!: string | null;
  weight!: number | null;
  goalWeight!: number | null;
  height!: number | null;
  dietType!: string | null;
  allergies!: string[];
  fitnessLevel!: string;
  lastLoginAt!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

export class AdminUserListResponseDto {
  success!: true;
  data!: AdminUserResponseDto[];
  pagination!: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class AdminUserDetailResponseDto {
  success!: true;
  data!: AdminUserResponseDto;
}

export class AdminUserStatusResponseDto {
  success!: true;
  message!: string;
  data!: {
    id: number;
    status: number;
    isActive: boolean;
  };
}
