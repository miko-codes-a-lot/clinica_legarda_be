import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

export type AppointmentEmailKind = 'confirmed' | 'rescheduled' | 'rejected' | 'cancelled' | 'disrupted' | 'needs_rescheduling';

@Schema({ _id: false })
export class AppointmentEmailSchedule {
  @Prop({ required: true }) date: string;
  @Prop({ required: true }) startTime: string;
  @Prop({ required: true }) endTime: string;
}

/** Transactional event snapshot; internal mail delivery metadata only. */
@Schema({ collection: 'appointment_change_emails', timestamps: true })
export class AppointmentChangeEmail {
  _id: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Appointment', required: true }) appointment: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true }) patient: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Clinic', required: true }) clinic: Types.ObjectId;
  @Prop({ enum: ['confirmed', 'rescheduled', 'rejected', 'cancelled', 'disrupted', 'needs_rescheduling'], required: true }) kind: AppointmentEmailKind;
  @Prop() eventKey?: string;
  @Prop() scheduleVersion?: number;
  @Prop() proposalId?: string;
  @Prop({ enum: ['patient', 'staff'] }) proposalSide?: 'patient' | 'staff';
  @Prop() proposalDeadline?: Date;
  @Prop() protectedCare?: boolean;
  @Prop({ type: AppointmentEmailSchedule, required: true }) schedule: AppointmentEmailSchedule;
  @Prop({ type: AppointmentEmailSchedule }) previousSchedule?: AppointmentEmailSchedule;
  @Prop({ maxlength: 500 }) reason?: string;
  @Prop() sentAt?: Date;
  @Prop() skippedAt?: Date;
  @Prop() lockedUntil?: Date;
  @Prop() leaseToken?: string;
  /** Text-message delivery of the same event, tracked apart from email so neither channel blocks the other. */
  @Prop() smsSentAt?: Date;
  @Prop() smsSkippedAt?: Date;
  @Prop() smsLockedUntil?: Date;
  @Prop() smsLeaseToken?: string;
  createdAt: Date;
}
export const AppointmentChangeEmailSchema = SchemaFactory.createForClass(AppointmentChangeEmail);
AppointmentChangeEmailSchema.index({ sentAt: 1, skippedAt: 1, lockedUntil: 1, createdAt: 1 });
AppointmentChangeEmailSchema.index({ smsSentAt: 1, smsSkippedAt: 1, smsLockedUntil: 1, createdAt: 1 });
AppointmentChangeEmailSchema.index({ eventKey: 1 }, { unique: true, sparse: true });
