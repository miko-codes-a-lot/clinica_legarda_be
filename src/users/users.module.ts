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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Clinic.name, schema: ClinicSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService, ProfilePictureGuard],
  exports: [UsersService],
})
export class UsersModule {}
