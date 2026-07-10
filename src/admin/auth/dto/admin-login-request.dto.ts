import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class AdminLoginRequestDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
