import { PatientCareController } from './patient-care.controller';
import { PatientCareService } from './patient-care.service';
import { ClinicClosure, ClinicClosureSchema } from '../clinic-closures/entities/clinic-closure.entity';
import { LedgerEntry, LedgerEntrySchema } from '../ledger/entities/ledger-entry.entity';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/entities/user.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { CareAccessService } from './care-access.service';
import { PatientRecordsController } from './patient-records.controller';
import { PatientRecordsService } from './patient-records.service';
import { Visit, VisitSchema } from './entities/visit.entity';
import { VisitsService } from './visits.service';
import { VisitsController } from './visits.controller';
import { TreatmentCase, TreatmentCaseSchema } from './entities/treatment-case.entity';
import { TreatmentCasesService } from './treatment-cases.service';
import { TreatmentCasesController } from './treatment-cases.controller';

@Module({
  imports: [MongooseModule.forFeature([
    { name: User.name, schema: UserSchema },
    { name: Appointment.name, schema: AppointmentSchema },
    { name: Clinic.name, schema: ClinicSchema },
      { name: ClinicClosure.name, schema: ClinicClosureSchema },
    { name: DentalCatalog.name, schema: DentalCatalogSchema },
    { name: Visit.name, schema: VisitSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
    { name: TreatmentCase.name, schema: TreatmentCaseSchema },
  ])],
  controllers: [PatientCareController, PatientRecordsController, VisitsController, TreatmentCasesController],
  providers: [PatientCareService, CareAccessService, PatientRecordsService, VisitsService, TreatmentCasesService],
  exports: [CareAccessService],
})
export class CareModule {}
