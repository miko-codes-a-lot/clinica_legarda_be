import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
@Schema({ collection: 'clinic_closures', timestamps: true })
export class ClinicClosure {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Clinic', required: true, immutable: true }) clinic: Types.ObjectId;
  @Prop({ required: true, immutable: true }) startDate: string;
  @Prop({ required: true, immutable: true }) endDate: string;
  @Prop({ required: true, immutable: true }) startTime: string;
  @Prop({ required: true, immutable: true }) endTime: string;
  @Prop({ required: true, maxlength: 500, immutable: true }) reason: string;
  @Prop({ type: String, enum: ['active', 'reopened'], default: 'active' }) status: 'active' | 'reopened';
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, immutable: true }) createdBy: Types.ObjectId;
  @Prop({ required: true, immutable: true }) createdByName: string;
  @Prop({ type: [MongoSchema.Types.ObjectId], ref: 'Appointment', default: [], immutable: true }) affectedAppointments: Types.ObjectId[];
  @Prop({ type: String, select: false, unique: true, sparse: true }) activeKey?: string;
  @Prop() reopenedAt?: Date;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User' }) reopenedBy?: Types.ObjectId;
  @Prop() reopenedByName?: string;
  @Prop({ maxlength: 500 }) reopenReason?: string;
}
export const ClinicClosureSchema = SchemaFactory.createForClass(ClinicClosure);
ClinicClosureSchema.index({ clinic: 1, status: 1, startDate: 1, endDate: 1 });
