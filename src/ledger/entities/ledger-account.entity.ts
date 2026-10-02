import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

@Schema({ collection: 'ledger_accounts', timestamps: true })
export class LedgerAccount {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true }) patient: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Clinic', required: true }) clinic: Types.ObjectId;
  @Prop({ default: 0 }) revision: number;
}
export const LedgerAccountSchema = SchemaFactory.createForClass(LedgerAccount);
LedgerAccountSchema.index({ patient: 1, clinic: 1 }, { unique: true });
