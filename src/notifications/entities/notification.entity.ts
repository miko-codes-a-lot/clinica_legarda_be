import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { User } from 'src/users/entities/user.entity';

export enum NotificationType {
  APPOINTMENT_CREATED = 'APPOINTMENT_CREATED',
  APPOINTMENT_STATUS_UPDATED = 'APPOINTMENT_STATUS_UPDATED',
  APPOINTMENT_REMINDER = 'APPOINTMENT_REMINDER',
}

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({
  collection: 'notifications',
  timestamps: true,
})
export class Notification {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  recipient: User;

  @Prop({ required: true })
  message: string; // e.g., "Your appointment has been confirmed."

  @Prop({ default: false })
  read: boolean;

  @Prop({ type: String, enum: NotificationType, required: true })
  type: NotificationType;

  @Prop()
  link?: string; // e.g., /appointments/60d...

  // Optional: The user who triggered the notification
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  triggeredBy?: User;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
