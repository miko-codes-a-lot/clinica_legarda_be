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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Referral.name, schema: ReferralSchema },
      { name: User.name, schema: UserSchema }, // ✅ ADD
      { name: DentalCatalog.name, schema: DentalCatalogSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: Visit.name, schema: VisitSchema },
      { name: TreatmentCase.name, schema: TreatmentCaseSchema },
    ]),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentSchedulingService],
  exports: [AppointmentsService], // ✅ REQUIRED
})
export class AppointmentsModule {}
