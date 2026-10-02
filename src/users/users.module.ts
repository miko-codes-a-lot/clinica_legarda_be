import { LedgerEntry, LedgerEntrySchema } from '../ledger/entities/ledger-entry.entity';
import { ProfilePictureGuard } from './profile-picture.guard';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/entities/appointment.entity';
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './entities/user.entity';
import { Clinic, ClinicSchema } from 'src/clinics/entities/clinic.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: Visit.name, schema: VisitSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService, ProfilePictureGuard],
  exports: [UsersService],
})
export class UsersModule {}
