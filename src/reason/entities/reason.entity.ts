import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ReasonDocument = Reason & Document;

export enum ReasonUsage {
  REFERRAL = 'referral',
  DECLINE = 'decline',
  BOTH = 'both',
}

@Schema({ timestamps: true })
export class Reason {
  @Prop({ required: true, unique: true, trim: true })
  code: string; // e.g. NO_AVAILABLE_SLOT

  @Prop({ required: true })
  label: string; // e.g. "No available schedule"

  @Prop()
  description?: string;

  @Prop({
    enum: Object.values(ReasonUsage),
    default: ReasonUsage.BOTH,
  })
  usage: ReasonUsage;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  sortOrder: number;
}

export const ReasonSchema = SchemaFactory.createForClass(Reason);
