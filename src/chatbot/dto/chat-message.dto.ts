import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChatTurnDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(2000)
  content: string;
}

export class ChatMessageDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  @ArrayMaxSize(20)
  history: ChatTurnDto[];

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;
}
