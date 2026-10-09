import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, Schema as MongoSchema } from 'mongoose';

/** Internal delivery state, never part of patient/staff appointment responses. */
@Schema({ collection: 'appointment_reminders', timestamps: true })
export class AppointmentReminder {
  @Prop({ type: String }) _id: string;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Appointment', required: true }) appointment: Types.ObjectId;
  @Prop() lockedUntil?: Date;
  @Prop() leaseToken?: string;
  @Prop() sentAt?: Date;
}

export const AppointmentReminderSchema = SchemaFactory.createForClass(AppointmentReminder);
