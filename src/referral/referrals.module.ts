import { User, UserSchema } from '../users/entities/user.entity';
import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralsController } from './referrals.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Referral, ReferralSchema } from './entities/referral.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { AppointmentsModule } from '../appointments/appointments.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Referral.name, schema: ReferralSchema },
      { name: Appointment.name, schema: AppointmentSchema }, // <-- add this
    ]),
    AppointmentsModule
  ],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
