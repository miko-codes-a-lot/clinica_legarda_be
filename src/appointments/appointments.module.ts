import { AppointmentSchedulingService } from './appointment-scheduling.service';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from './entities/appointment.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import {
  DentalCatalog,
  DentalCatalogSchema,
} from '../dental-catalog/entities/dental-catalog.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: User.name, schema: UserSchema },                 // ✅ ADD
      { name: DentalCatalog.name, schema: DentalCatalogSchema },
      { name: Clinic.name, schema: ClinicSchema }
    ]),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentSchedulingService],
  exports: [AppointmentsService], // ✅ REQUIRED
})
export class AppointmentsModule {}
