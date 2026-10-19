import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppointmentsModule } from '../appointments/appointments.module';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { Notification, NotificationSchema } from '../notifications/entities/notification.entity';
import { AppointmentChangeEmail, AppointmentChangeEmailSchema } from '../appointment-change-emails/entities/appointment-change-email.entity';
import { DentistDayAvailability, DentistDayAvailabilitySchema } from './entities/dentist-day-availability.entity';
import { DentistAvailabilityService } from './dentist-availability.service';
import { DentistAvailabilityController } from './dentist-availability.controller';
@Module({ imports: [AppointmentsModule, MongooseModule.forFeature([
  { name: User.name, schema: UserSchema }, { name: Clinic.name, schema: ClinicSchema }, { name: Appointment.name, schema: AppointmentSchema },
  { name: Visit.name, schema: VisitSchema }, { name: Notification.name, schema: NotificationSchema },
  { name: AppointmentChangeEmail.name, schema: AppointmentChangeEmailSchema }, { name: DentistDayAvailability.name, schema: DentistDayAvailabilitySchema },
])], controllers: [DentistAvailabilityController], providers: [DentistAvailabilityService] })
export class DentistAvailabilityModule {}
