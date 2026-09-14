import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import {
  Appointment,
  AppointmentSchema,
} from 'src/appointments/entities/appointment.entity';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Referral,
  ReferralSchema,
} from 'src/referral/entities/referral.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Referral.name, schema: ReferralSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
