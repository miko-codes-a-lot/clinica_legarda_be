import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { AppointmentStatus } from 'src/_shared/enum/appointment-status.enum';
import { Clinic } from 'src/clinics/entities/clinic.entity'; // <-- Adjust path as needed
import { DentalCatalog } from 'src/dental-catalog/entities/dental-catalog.entity';
import { User } from 'src/users/entities/user.entity'; // <-- Adjust path as needed

@Schema({
  _id: false,
  timestamps: { createdAt: 'timestamp', updatedAt: false },
})
export class AppointmentHistory {
  @Prop({ required: true })
  action: string;

  timestamp: Date;
}

@Schema({ _id: false })
export class AppointmentNote {
  @Prop({ default: '' })
  patientNotes: string;

  @Prop({ default: '' })
  clinicNotes: string;
}

export type AppointmentDocument = HydratedDocument<Appointment>;

@Schema({
  collection: 'appointments',
  timestamps: true,
})
export class Appointment {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true })
  clinic: Clinic;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  patient: User;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  dentist: User;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: DentalCatalog.name }],
  })
  services: DentalCatalog[];

  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  startTime: string; // e.g., "09:00"

  @Prop({ required: true })
  endTime: string; // e.g., "10:00"

  @Prop({
    type: String,
    enum: AppointmentStatus,
    default: AppointmentStatus.PENDING,
  })
  status: AppointmentStatus;

  @Prop({ type: AppointmentNote, default: () => ({}) })
  notes: AppointmentNote;

  @Prop({ type: [AppointmentHistory], default: [] })
  history: AppointmentHistory[];
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);
