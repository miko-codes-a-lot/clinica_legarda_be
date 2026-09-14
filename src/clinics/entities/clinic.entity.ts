import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { OperatingHour } from 'src/_shared/entities/operating-hour';
import { User } from 'src/users/entities/user.entity';

export type ClinicDocument = HydratedDocument<Clinic>;

@Schema({
  collection: 'clinics',
  timestamps: true,
})
export class Clinic {
  @Prop()
  name: string;

  // Optional so existing records need no migration before new writes are protected.
  @Prop({ unique: true, sparse: true, select: false })
  nameKey?: string;

  @Prop({ trim: true })
  address: string;

  @Prop({ trim: true })
  mobileNumber: string;

  @Prop({ trim: true })
  emailAddress: string;

  @Prop()
  operatingHours: OperatingHour[];

  // virtual property i.e., not stored in db
  dentists?: User[];
}

export const ClinicSchema = SchemaFactory.createForClass(Clinic);
