import { IsString, MaxLength, MinLength } from "class-validator";

export class CreateRagUrlRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  url!: string;
}
