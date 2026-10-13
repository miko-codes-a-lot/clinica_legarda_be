import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

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
  @Prop({ enum: ['rescheduled', 'rejected'], required: true }) kind: 'rescheduled' | 'rejected';
  @Prop({ type: AppointmentEmailSchedule, required: true }) schedule: AppointmentEmailSchedule;
  @Prop({ type: AppointmentEmailSchedule }) previousSchedule?: AppointmentEmailSchedule;
  @Prop({ maxlength: 500 }) reason?: string;
  @Prop() sentAt?: Date;
  @Prop() skippedAt?: Date;
  @Prop() lockedUntil?: Date;
  @Prop() leaseToken?: string;
  createdAt: Date;
}
export const AppointmentChangeEmailSchema = SchemaFactory.createForClass(AppointmentChangeEmail);
AppointmentChangeEmailSchema.index({ sentAt: 1, skippedAt: 1, lockedUntil: 1, createdAt: 1 });
