import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { OperatingHour } from 'src/_shared/entities/operating-hour';
import { Clinic } from 'src/clinics/entities/clinic.entity';

export type UserDocument = HydratedDocument<User>;

@Schema({
  collection: 'users',
})
export class User {
  @Prop()
  firstName: string;

  @Prop()
  middleName?: string;

  @Prop()
  lastName: string;

  @Prop()
  emailAddress: string;

  @Prop()
  mobileNumber: string;

  @Prop()
  address: string;

  @Prop()
  username: string;

  @Prop({ select: false })
  password?: string;

  @Prop({ ref: () => Clinic.name })
  clinic?: Clinic;

  @Prop()
  operatingHours?: OperatingHour[];

  // appointments: Appointment[]

  @Prop()
  role: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
