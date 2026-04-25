import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/auth.guard';
import { ChatMessageDto } from './dto/chat-message.dto';
import { ChatbotService } from './chatbot.service';

@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly svc: ChatbotService) {}

  @Public()
  @Throttle({ chatbot: { limit: 20, ttl: 60_000 } })
  @Post('message')
  async send(@Body() dto: ChatMessageDto) {
    return { reply: await this.svc.reply(dto) };
  }
}
