import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';

export const VISIT_STATES = ['waiting', 'in_progress', 'completed', 'cancelled'] as const;
export type VisitState = typeof VISIT_STATES[number];
export type VisitPurpose = 'consultation' | 'treatment';

@Schema({ _id: false })
export class VisitTreatment {
  @Prop({ required: true, trim: true, maxlength: 500 }) description: string;
  @Prop({ trim: true, maxlength: 100 }) tooth?: string;
  @Prop({ trim: true, maxlength: 4000 }) notes?: string;
}

@Schema({ _id: false })
export class VisitEvent {
  @Prop({ required: true }) state: string;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true }) actor: Types.ObjectId;
  @Prop({ required: true }) at: Date;
  @Prop({ maxlength: 500 }) reason?: string;
}

@Schema({ collection: 'visits', timestamps: true, toJSON: { transform: (_doc, result: Record<string, unknown>) => { delete result.activeKey; delete result.appointmentKey; return result; } } })
export class Visit {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, index: true }) patient: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Clinic', required: true, index: true }) clinic: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, index: true }) dentist: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Appointment', index: true }) appointment?: Types.ObjectId;
  @Prop({ unique: true, sparse: true, select: false }) appointmentKey?: string;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'TreatmentCase' }) careCase?: Types.ObjectId;
  @Prop({ required: true, index: true }) date: string;
  @Prop({ required: true }) checkedInAt: Date;
  @Prop() startedAt?: Date;
  @Prop() endedAt?: Date;
  @Prop({ type: String, enum: VISIT_STATES, default: 'waiting' }) state: VisitState;
  @Prop({ type: String, enum: ['consultation', 'treatment'], required: true }) purpose: VisitPurpose;
  @Prop({ default: false }) isWalkIn: boolean;
  @Prop({ unique: true, sparse: true, select: false }) activeKey?: string;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true }) createdBy: Types.ObjectId;
  @Prop({ type: [VisitEvent], default: [] }) events: VisitEvent[];
  @Prop({ default: 0 }) revision: number;
  @Prop({ default: '', maxlength: 10000 }) assessment: string;
  @Prop({ type: [VisitTreatment], default: [] }) treatments: VisitTreatment[];
  @Prop({ default: '', maxlength: 4000 }) summary: string;
  @Prop({ default: '', maxlength: 4000 }) aftercare: string;
  @Prop({ default: '', maxlength: 4000 }) nextSteps: string;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User' }) clinicalAuthor?: Types.ObjectId;
  @Prop() clinicalUpdatedAt?: Date;
}
export type VisitDocument = HydratedDocument<Visit>;
export const VisitSchema = SchemaFactory.createForClass(Visit);
VisitSchema.index({ clinic: 1, date: 1, state: 1, checkedInAt: 1 });
