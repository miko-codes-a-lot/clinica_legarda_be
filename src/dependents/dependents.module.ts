import { PatientRecordChangesModule } from '../patient-record-changes/patient-record-changes.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/entities/user.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { DependentsService } from './dependents.service';
import { DependentsController } from './dependents.controller';
@Module({ imports: [PatientRecordChangesModule, MongooseModule.forFeature([{ name: User.name, schema: UserSchema }, { name: Appointment.name, schema: AppointmentSchema }, { name: Visit.name, schema: VisitSchema }])],
  providers: [DependentsService], controllers: [DependentsController] })
export class DependentsModule {}
