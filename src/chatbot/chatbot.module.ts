import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRoot([
      { name: 'chatbot', ttl: 60_000, limit: 20 },
    ]),
  ],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class ChatbotModule {}
