import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import { Dentition } from '../chart-rules';
@Schema({ _id: false })
export class DentalToothObservation {
  @Prop({ required: true }) tooth: number;
  @Prop({ required: true, maxlength: 1000 }) observation: string;
  @Prop({ default: '', maxlength: 2000 }) notes: string;
}
@Schema({ collection: 'dental_charts' })
export class DentalChart {
  _id: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true }) patient: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Clinic', required: true }) clinic: Types.ObjectId;
  @Prop({ required: true, enum: ['permanent','primary'] }) dentition: Dentition;
  @Prop({ required: true, min: 1 }) revision: number;
  @Prop({ type: [DentalToothObservation], default: [] }) teeth: DentalToothObservation[];
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true }) updatedBy: Types.ObjectId;
  @Prop({ required: true }) updatedAt: Date;
}
export const DentalChartSchema = SchemaFactory.createForClass(DentalChart);
DentalChartSchema.index({ patient: 1, clinic: 1, dentition: 1 }, { unique: true });
@Schema({ collection: 'dental_chart_versions' })
export class DentalChartVersion extends DentalChart {}
export const DentalChartVersionSchema = SchemaFactory.createForClass(DentalChartVersion);
DentalChartVersionSchema.index({ patient: 1, clinic: 1, dentition: 1, revision: 1 }, { unique: true });
for (const path of ['patient','clinic','dentition','revision','teeth','updatedBy','updatedAt']) DentalChartVersionSchema.path(path).immutable(true);
export interface DentalChartView extends Omit<DentalChart, 'clinic' | 'updatedBy'> {
  clinic: { _id: Types.ObjectId; name: string };
  updatedBy: { _id: Types.ObjectId; firstName?: string; middleName?: string; lastName?: string };
}
export type DentalChartRevision = Pick<DentalChartView, 'revision' | 'updatedBy' | 'updatedAt'>;
