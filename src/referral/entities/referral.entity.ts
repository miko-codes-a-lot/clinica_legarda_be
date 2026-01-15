import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { User } from 'src/users/entities/user.entity';
import { Clinic } from 'src/clinics/entities/clinic.entity';
import { Appointment } from 'src/appointments/entities/appointment.entity';
import { ReferralStatus } from 'src/_shared/enum/referral-status.enum';

export type ReferralDocument = HydratedDocument<Referral>;

@Schema({
  collection: 'referrals',
  timestamps: true,
})
export class Referral {

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  fromDoctorId: User[];

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true })
  fromClinicId: Clinic;

  @Prop({ trim: true })
  reason: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: false })
  appointment?: Appointment;

  @Prop({
    type: String,
    enum: ReferralStatus,
    default: ReferralStatus.PENDING,
  })
  status: ReferralStatus;

}

export const ReferralSchema = SchemaFactory.createForClass(Referral);