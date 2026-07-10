export class AdminProfileResponseDto {
  id!: number;
  email!: string | null;
  displayName!: string;
  avatarUrl!: string | null;
  role!: "admin";
}
