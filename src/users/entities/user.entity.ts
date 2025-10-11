import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { OperatingHour } from 'src/_shared/entities/operating-hour';
import { Clinic } from 'src/clinics/entities/clinic.entity';

export type UserDocument = HydratedDocument<User>;

@Schema({
  collection: 'users',
  timestamps: true,
})
export class User {
  _id: mongoose.Types.ObjectId;

  @Prop()
  profilePicture: string; // image name

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

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: () => Clinic.name })
  clinic?: Clinic;

  @Prop()
  operatingHours?: OperatingHour[];

  // appointments: Appointment[]

  @Prop()
  role: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
