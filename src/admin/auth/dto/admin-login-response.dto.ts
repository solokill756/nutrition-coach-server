import { AdminProfileResponseDto } from "./admin-profile-response.dto";

export class AdminLoginDataDto {
  accessToken!: string;
  admin!: AdminProfileResponseDto;
}

export class AdminLoginResponseDto {
  success!: true;
  data!: AdminLoginDataDto;
}
