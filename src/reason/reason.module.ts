import { Module } from '@nestjs/common';
import { ReasonService } from './reason.service';
import { ReasonController } from './reason.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Reason, ReasonSchema } from './entities/reason.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reason.name, schema: ReasonSchema },
    ]),
  ],
  controllers: [ReasonController],
  providers: [ReasonService],
})
export class ReasonModule {}
