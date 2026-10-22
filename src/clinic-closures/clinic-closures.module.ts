import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { AppointmentChangeEmail, AppointmentChangeEmailSchema } from '../appointment-change-emails/entities/appointment-change-email.entity';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Notification, NotificationSchema } from '../notifications/entities/notification.entity';
import { ClinicClosure, ClinicClosureSchema } from './entities/clinic-closure.entity';
import { ClinicClosuresController } from './clinic-closures.controller';
import { ClinicClosuresService } from './clinic-closures.service';
@Module({ imports: [MongooseModule.forFeature([{ name: Visit.name, schema: VisitSchema }, { name: DentalCatalog.name, schema: DentalCatalogSchema }, { name: Clinic.name, schema: ClinicSchema }, { name: Appointment.name, schema: AppointmentSchema },
  { name: AppointmentChangeEmail.name, schema: AppointmentChangeEmailSchema }, { name: User.name, schema: UserSchema }, { name: Notification.name, schema: NotificationSchema }, { name: ClinicClosure.name, schema: ClinicClosureSchema }])],
  controllers: [ClinicClosuresController], providers: [ClinicClosuresService] })
export class ClinicClosuresModule {}
