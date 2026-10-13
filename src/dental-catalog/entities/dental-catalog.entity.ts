import { Types } from 'mongoose';
import { Clinic } from '../../clinics/entities/clinic.entity';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({
  collection: 'services',
  timestamps: true,
})
export class DentalCatalog {
  @Prop({
    unique: true,
    trim: true,
  })
  name: string;

  @Prop()
  duration: number;

  @Prop({ type: [{ type: Types.ObjectId, ref: Clinic.name }], default: undefined })
  clinics?: Types.ObjectId[];
}

export const DentalCatalogSchema = SchemaFactory.createForClass(DentalCatalog);
