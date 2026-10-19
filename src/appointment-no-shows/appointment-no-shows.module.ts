import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppointmentsModule } from '../appointments/appointments.module';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { ClinicClosure, ClinicClosureSchema } from '../clinic-closures/entities/clinic-closure.entity';
import { DentistDayAvailability, DentistDayAvailabilitySchema } from '../dentist-availability/entities/dentist-day-availability.entity';
import { AppointmentNoShowsService } from './appointment-no-shows.service';
@Module({ imports: [ConfigModule, AppointmentsModule, MongooseModule.forFeature([
  { name: Appointment.name, schema: AppointmentSchema }, { name: Visit.name, schema: VisitSchema }, { name: User.name, schema: UserSchema },
  { name: Clinic.name, schema: ClinicSchema }, { name: ClinicClosure.name, schema: ClinicClosureSchema }, { name: DentistDayAvailability.name, schema: DentistDayAvailabilitySchema },
])], providers: [AppointmentNoShowsService] })
export class AppointmentNoShowsModule {}
