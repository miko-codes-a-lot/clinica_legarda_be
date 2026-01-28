import { Module } from '@nestjs/common';
import { ReasonService } from './reason.service';
import { ReasonController } from './reason.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Reason, ReasonSchema } from './entities/reason.entity';
// import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { AppointmentsModule } from '../appointments/appointments.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reason.name, schema: ReasonSchema },
      // { name: Appointment.name, schema: AppointmentSchema },
    ]),
    AppointmentsModule
  ],
  controllers: [ReasonController],
  providers: [ReasonService],
  exports: [ReasonService],
})
export class ReasonModule {}
