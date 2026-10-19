import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppointmentChangeEmail, AppointmentChangeEmailSchema } from './entities/appointment-change-email.entity';
import { AppointmentChangeEmailsService } from './appointment-change-emails.service';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { MailerModule } from '../mailer/mailer.module';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';

@Module({
  imports: [ConfigModule, MailerModule, MongooseModule.forFeature([
    { name: AppointmentChangeEmail.name, schema: AppointmentChangeEmailSchema },
    { name: User.name, schema: UserSchema }, { name: Clinic.name, schema: ClinicSchema },
    { name: Appointment.name, schema: AppointmentSchema },
  ])],
  providers: [AppointmentChangeEmailsService],
})
export class AppointmentChangeEmailsModule {}
