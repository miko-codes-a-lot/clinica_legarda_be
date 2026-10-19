import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PatientRecordChange, PatientRecordChangeSchema, PatientRecordAuditState, PatientRecordAuditStateSchema } from './entities/patient-record-change.entity';
import { PatientRecordChangesService } from './patient-record-changes.service';
@Module({ imports: [MongooseModule.forFeature([{ name: PatientRecordChange.name, schema: PatientRecordChangeSchema }, { name: PatientRecordAuditState.name, schema: PatientRecordAuditStateSchema }])],
  providers: [PatientRecordChangesService], exports: [PatientRecordChangesService] })
export class PatientRecordChangesModule {}
