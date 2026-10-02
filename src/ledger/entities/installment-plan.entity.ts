import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

@Schema({ _id: false })
export class Installment {
  @Prop({ required: true }) dueDate: string;
  @Prop({ required: true, min: 1, validate: Number.isSafeInteger }) amount: number;
}
@Schema({ _id: false })
export class InstallmentRevision {
  @Prop({ required: true }) revision: number;
  @Prop({ type: [Installment], required: true }) items: Installment[];
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true }) actor: Types.ObjectId;
  @Prop({ required: true }) actorName: string;
  @Prop({ required: true }) at: Date;
  @Prop({ required: true, maxlength: 500 }) reason: string;
}
@Schema({ collection: 'installment_plans', timestamps: true })
export class InstallmentPlan {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'LedgerEntry', required: true, unique: true, immutable: true }) charge: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, immutable: true }) patient: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Clinic', required: true, immutable: true }) clinic: Types.ObjectId;
  @Prop({ type: [Installment], required: true }) items: Installment[];
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, immutable: true }) createdBy: Types.ObjectId;
  @Prop({ required: true, immutable: true }) createdByName: string;
  @Prop({ default: 0 }) revision: number;
  @Prop({ type: [InstallmentRevision], default: [] }) history: InstallmentRevision[];
}
export const InstallmentPlanSchema = SchemaFactory.createForClass(InstallmentPlan);
