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
}

export const DentalCatalogSchema = SchemaFactory.createForClass(DentalCatalog);
