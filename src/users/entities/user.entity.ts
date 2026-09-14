import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { OperatingHour } from 'src/_shared/entities/operating-hour';
import { UserStatus } from 'src/_shared/enum/user-status.enum';
import { Clinic } from 'src/clinics/entities/clinic.entity';

export type UserDocument = HydratedDocument<User>;

@Schema({
  collection: 'users',
  timestamps: true,
  toJSON: {
    transform: (_doc, result: Record<string, unknown>) => {
      delete result.password;
      delete result.resetOtp;
      delete result.resetOtpExpires;
      delete result.resetOtpVerified;
      delete result.scheduleRevision;
      return result;
    },
  },
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

  // Do not default to []: old documents must retain their single-clinic fallback.
  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: () => Clinic.name }],
    default: undefined,
  })
  clinics?: Clinic[];

  @Prop()
  operatingHours?: OperatingHour[];

  // appointments: Appointment[]

  @Prop()
  role: string;

  @Prop({ enum: UserStatus, default: UserStatus.PENDING })
  status: UserStatus;

  // DAILY CAPACITY
  @Prop({ default: 480 })
  maxWorkingMinutesPerDay: number;

  // BUFFER BETWEEN APPOINTMENTS
  @Prop({ default: 15 })
  appointmentBufferMinutes: number;

  // Internal cross-process scheduling lock; never returned in user responses.
  @Prop({ select: false })
  scheduleRevision?: number;

  @Prop()
  otpVerifiedAt?: Date;

  @Prop({ select: false })
  resetOtp?: string;

  @Prop({ select: false })
  resetOtpExpires?: Date;

  @Prop({ select: false, default: false })
  resetOtpVerified?: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
