import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { OperatingHour } from 'src/_shared/entities/operating-hour';
import { User } from 'src/users/entities/user.entity';

export type ClinicDocument = HydratedDocument<Clinic>;

@Schema({
  collection: 'clinics',
})
export class Clinic {
  @Prop()
  name: string;

  @Prop()
  address: string;

  @Prop()
  mobileNumber: string;

  @Prop()
  emailAddress: string;

  @Prop()
  operatingHours: OperatingHour[];

  // virtual property i.e., not stored in db
  dentists?: User[];
}

export const ClinicSchema = SchemaFactory.createForClass(Clinic);

ClinicSchema.virtual('dentists', {
  ref: 'User',
  localField: '_id',
  foreignField: 'clinic',
  match: { role: 'dentist' }, // only user that have 'dentist' role
  justOne: false,
});
