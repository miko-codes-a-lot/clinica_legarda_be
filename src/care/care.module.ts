import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/entities/user.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { CareAccessService } from './care-access.service';
import { PatientRecordsController } from './patient-records.controller';
import { PatientRecordsService } from './patient-records.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: User.name, schema: UserSchema },
    { name: Appointment.name, schema: AppointmentSchema },
    { name: Clinic.name, schema: ClinicSchema },
    { name: DentalCatalog.name, schema: DentalCatalogSchema },
  ])],
  controllers: [PatientRecordsController],
  providers: [CareAccessService, PatientRecordsService],
  exports: [CareAccessService],
})
export class CareModule {}
