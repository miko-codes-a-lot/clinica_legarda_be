import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

@Schema({ _id: false })
export class DentistAvailabilityInterval {
  @Prop({ required: true }) startTime: string;
  @Prop({ required: true }) endTime: string;
}
@Schema({ collection: 'dentist_day_availability', timestamps: true })
export class DentistDayAvailability {
  _id: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true }) dentist: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Clinic', required: true }) clinic: Types.ObjectId;
  @Prop({ required: true }) date: string;
  @Prop({ type: [DentistAvailabilityInterval], default: [] }) intervals: DentistAvailabilityInterval[];
  @Prop({ required: true, default: 1 }) revision: number;
  // Retain a revision tombstone when restoring weekly hours, preventing stale-save ABA races.
  @Prop({ default: false }) useWeeklyHours: boolean;
}
export const DentistDayAvailabilitySchema = SchemaFactory.createForClass(DentistDayAvailability);
DentistDayAvailabilitySchema.index({ dentist: 1, clinic: 1, date: 1 }, { unique: true });
