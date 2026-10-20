import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { MailerModule } from '../mailer/mailer.module';
import { SmsModule } from '../sms/sms.module';
import { AppointmentReminder, AppointmentReminderSchema } from './entities/appointment-reminder.entity';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { AppointmentSmsRemindersService } from './appointment-sms-reminders.service';

@Module({
  imports: [ConfigModule, MailerModule, SmsModule, MongooseModule.forFeature([
    { name: Appointment.name, schema: AppointmentSchema },
    { name: User.name, schema: UserSchema },
    { name: Clinic.name, schema: ClinicSchema },
    { name: AppointmentReminder.name, schema: AppointmentReminderSchema },
  ])],
  providers: [AppointmentRemindersService, AppointmentSmsRemindersService],
})
export class AppointmentRemindersModule {}
