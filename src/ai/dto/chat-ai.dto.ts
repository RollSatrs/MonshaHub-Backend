import { IsNotEmpty, IsString } from 'class-validator';

export class ChatAiDto {
  @IsString()
  @IsNotEmpty()
  message: string;
}
