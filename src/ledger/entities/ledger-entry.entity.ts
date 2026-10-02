import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

@Schema({ collection: 'ledger_entries', timestamps: true })
export class LedgerEntry {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, immutable: true }) patient: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Clinic', required: true, immutable: true }) clinic: Types.ObjectId;
  @Prop({ type: String, enum: ['charge', 'payment'], required: true, immutable: true }) kind: 'charge' | 'payment';
  @Prop({ required: true, min: 1, validate: Number.isSafeInteger, immutable: true }) amount: number;
  @Prop({ required: true, immutable: true }) date: string;
  @Prop({ required: true, trim: true, maxlength: 500, immutable: true }) description: string;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'LedgerEntry', immutable: true }) charge?: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Visit', immutable: true }) visit?: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'TreatmentCase', immutable: true }) careCase?: Types.ObjectId;
  @Prop({ trim: true, maxlength: 100, immutable: true }) method?: string;
  @Prop({ trim: true, maxlength: 200, immutable: true }) reference?: string;
  @Prop({ trim: true, maxlength: 500, immutable: true }) notes?: string;
  @Prop({ required: true, lowercase: true, immutable: true }) operationId: string;
  @Prop({ required: true, select: false, immutable: true }) signature: string;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, immutable: true }) actor: Types.ObjectId;
  @Prop({ required: true, immutable: true }) actorName: string;
  @Prop({ required: true, immutable: true }) actorRole: string;
  @Prop() voidedAt?: Date;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User' }) voidedBy?: Types.ObjectId;
  @Prop() voidedByName?: string;
  @Prop({ trim: true, maxlength: 500 }) voidReason?: string;
  createdAt: Date;
}
export const LedgerEntrySchema = SchemaFactory.createForClass(LedgerEntry);
LedgerEntrySchema.index({ patient: 1, clinic: 1, operationId: 1 }, { unique: true });
LedgerEntrySchema.index({ patient: 1, clinic: 1, date: -1 });
LedgerEntrySchema.index({ charge: 1, kind: 1, voidedAt: 1 });
