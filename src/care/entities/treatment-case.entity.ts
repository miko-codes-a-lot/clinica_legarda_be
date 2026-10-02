import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';

@Schema({ collection: 'treatment_cases', timestamps: true })
export class TreatmentCase {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, index: true }) patient: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Clinic', required: true, index: true }) clinic: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, index: true }) dentist: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Visit', required: true, unique: true }) consultationVisit: Types.ObjectId;
  @Prop({ required: true, trim: true, maxlength: 200 }) title: string;
  @Prop({ required: true, trim: true, maxlength: 4000 }) plan: string;
  @Prop({ trim: true, maxlength: 10000, default: '' }) internalNotes: string;
  @Prop({ type: String, enum: ['active', 'completed', 'discontinued'], default: 'active' }) status: 'active' | 'completed' | 'discontinued';
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true }) createdBy: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User' }) closedBy?: Types.ObjectId;
  @Prop() closedAt?: Date;
  @Prop({ default: 0 }) revision: number;
  createdAt: Date;
}
export type TreatmentCaseDocument = HydratedDocument<TreatmentCase>;
export const TreatmentCaseSchema = SchemaFactory.createForClass(TreatmentCase);
