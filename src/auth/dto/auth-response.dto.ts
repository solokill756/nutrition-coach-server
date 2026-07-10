export class AuthResponseDto {
  accessToken!: string;
  refreshToken!: string;
  expiresIn!: number;
  isNewUser!: boolean;
  user!: {
    id: number;
    email: string | null;
    displayName: string;
    avatarUrl: string | null;
    status: number;
    isProfileComplete: boolean;
    age?: number | null;
    gender?: string | null;
    heightCm?: number | null;
    currentWeightKg?: number | null;
    goalWeightKg?: number | null;
  };
}
