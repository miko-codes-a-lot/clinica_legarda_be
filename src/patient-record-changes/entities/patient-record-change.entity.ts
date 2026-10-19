import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
@Schema({ collection: 'patient_record_changes', versionKey: false })
export class PatientRecordChange {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, immutable: true }) patient: Types.ObjectId;
  @Prop({ type: [MongoSchema.Types.ObjectId], ref: 'Clinic', required: true, immutable: true }) clinicScope: Types.ObjectId[];
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, immutable: true }) actorId: Types.ObjectId;
  @Prop({ required: true, immutable: true }) actorRole: string;
  @Prop({ immutable: true }) actorName?: string;
  @Prop({ enum: ['profile','clinical','dental_chart'], required: true, immutable: true }) kind: 'profile' | 'clinical' | 'dental_chart';
  @Prop({ type: [String], required: true, immutable: true }) fields: string[];
  @Prop({ required: true, immutable: true }) sourceEventId: string;
  @Prop({ required: true, immutable: true, default: Date.now }) createdAt: Date;
}
export const PatientRecordChangeSchema = SchemaFactory.createForClass(PatientRecordChange);
PatientRecordChangeSchema.index({ sourceEventId: 1 }, { unique: true });
PatientRecordChangeSchema.index({ clinicScope: 1, createdAt: 1 });
@Schema({ collection: 'patient_record_audit_state', versionKey: false })
export class PatientRecordAuditState {
  @Prop({ type: String, default: 'coverage' }) _id: string;
  @Prop({ required: true, immutable: true }) startedAt: Date;
}
export const PatientRecordAuditStateSchema = SchemaFactory.createForClass(PatientRecordAuditState);
