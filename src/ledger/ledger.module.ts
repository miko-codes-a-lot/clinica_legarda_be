import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CareModule } from '../care/care.module';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { TreatmentCase, TreatmentCaseSchema } from '../care/entities/treatment-case.entity';
import { LedgerAccount, LedgerAccountSchema } from './entities/ledger-account.entity';
import { LedgerEntry, LedgerEntrySchema } from './entities/ledger-entry.entity';
import { InstallmentPlan, InstallmentPlanSchema } from './entities/installment-plan.entity';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
@Module({ imports: [CareModule, MongooseModule.forFeature([
  { name: User.name, schema: UserSchema }, { name: Clinic.name, schema: ClinicSchema }, { name: Appointment.name, schema: AppointmentSchema },
  { name: Visit.name, schema: VisitSchema }, { name: TreatmentCase.name, schema: TreatmentCaseSchema }, { name: LedgerAccount.name, schema: LedgerAccountSchema },
  { name: LedgerEntry.name, schema: LedgerEntrySchema }, { name: InstallmentPlan.name, schema: InstallmentPlanSchema },
])], controllers: [LedgerController], providers: [LedgerService] })
export class LedgerModule {}
