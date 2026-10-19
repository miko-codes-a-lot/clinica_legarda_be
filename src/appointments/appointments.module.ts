import { ClinicClosure, ClinicClosureSchema } from '../clinic-closures/entities/clinic-closure.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
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
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { TreatmentCase, TreatmentCaseSchema } from '../care/entities/treatment-case.entity';
import { AppointmentChangeEmail, AppointmentChangeEmailSchema } from '../appointment-change-emails/entities/appointment-change-email.entity';
import { DentistDayAvailability, DentistDayAvailabilitySchema } from '../dentist-availability/entities/dentist-day-availability.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AppointmentChangeEmail.name, schema: AppointmentChangeEmailSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: DentistDayAvailability.name, schema: DentistDayAvailabilitySchema },
      { name: Referral.name, schema: ReferralSchema },
      { name: User.name, schema: UserSchema }, // ✅ ADD
      { name: DentalCatalog.name, schema: DentalCatalogSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: ClinicClosure.name, schema: ClinicClosureSchema },
      { name: Visit.name, schema: VisitSchema },
      { name: TreatmentCase.name, schema: TreatmentCaseSchema },
    ]),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentSchedulingService],
  exports: [AppointmentsService, AppointmentSchedulingService],
})
export class AppointmentsModule {}
