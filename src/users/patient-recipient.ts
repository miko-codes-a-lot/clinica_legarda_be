import { ClientSession, Model, Types } from 'mongoose';
import { User } from './entities/user.entity';
import { UserStatus } from '../_shared/enum/user-status.enum';
import { referenceId } from '../auth/reference-id';

interface GuardianRecipient { _id: Types.ObjectId; role: string; status: UserStatus; otpVerifiedAt?: Date; isDependent?: boolean; loginEnabled?: boolean; emailAddress?: string; mobileNumber?: string; }
export interface PatientRecipientSource { _id: Types.ObjectId; firstName?: string; lastName?: string; emailAddress?: string; mobileNumber?: string; isDependent?: boolean; loginEnabled?: boolean; guardian?: GuardianRecipient | Types.ObjectId | null; }
export interface PatientNoticeRecipient { id: string; emailAddress?: string; mobileNumber?: string; patientName?: string; }
export const GUARDIAN_RECIPIENT_FIELDS = '_id role status otpVerifiedAt isDependent loginEnabled emailAddress mobileNumber';
export const PATIENT_RECIPIENT_FIELDS = '_id firstName lastName emailAddress mobileNumber isDependent loginEnabled guardian';
export function patientRecipient(patient: PatientRecipientSource | null | undefined): PatientNoticeRecipient | null {
  if (!patient) return null;
  if (!patient.isDependent) return { id: referenceId(patient._id), emailAddress: patient.emailAddress, mobileNumber: patient.mobileNumber };
  const guardian = patient.guardian;
  if (!guardian || !('role' in guardian) || guardian.role !== 'user' || guardian.status !== UserStatus.CONFIRMED || !guardian.otpVerifiedAt || guardian.isDependent || guardian.loginEnabled === false) return null;
  return { id: referenceId(guardian._id), emailAddress: guardian.emailAddress, mobileNumber: guardian.mobileNumber, patientName: [patient.firstName, patient.lastName].filter(Boolean).join(' ') || 'Child patient' };
}
export async function findPatientRecipient(users: Model<User>, id: unknown, session?: ClientSession): Promise<PatientNoticeRecipient | null> {
  const patient = await users.findById(referenceId(id)).select(PATIENT_RECIPIENT_FIELDS)
    .populate({ path: 'guardian', select: GUARDIAN_RECIPIENT_FIELDS }).session(session ?? null).lean<PatientRecipientSource>();
  return patientRecipient(patient);
}
