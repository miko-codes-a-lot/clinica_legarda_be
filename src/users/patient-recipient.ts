import { ClientSession, Model, Types } from 'mongoose';
import { User } from './entities/user.entity';
import { UserStatus } from '../_shared/enum/user-status.enum';
import { referenceId } from '../auth/reference-id';
import { normalizeTo639 } from '../auth/sms.helper';

interface GuardianRecipient { _id: Types.ObjectId; role: string; status: UserStatus; otpVerifiedAt?: Date; isDependent?: boolean; loginEnabled?: boolean; emailAddress?: string; mobileNumber?: string; }
export interface PatientRecipientSource { _id: Types.ObjectId; firstName?: string; lastName?: string; emailAddress?: string; mobileNumber?: string; isDependent?: boolean; loginEnabled?: boolean; guardian?: GuardianRecipient | Types.ObjectId | null; }
export interface PatientNoticeRecipient { id: string; emailAddress?: string; mobileNumber?: string; patientName?: string; }
export const GUARDIAN_RECIPIENT_FIELDS = '_id role status otpVerifiedAt isDependent loginEnabled emailAddress mobileNumber';
export const PATIENT_RECIPIENT_FIELDS = '_id firstName lastName emailAddress mobileNumber isDependent loginEnabled guardian';
// Learning records contain fictional mobile contacts. A real replacement number remains usable.
const LEARNING_MOBILES: Readonly<Record<string, string>> = {
  '70c400000000000000000006': '639171113001',
  '70c400000000000000000007': '639171113002',
  '70c400000000000000000008': '639171113003',
  '70c400000000000000000009': '639171113004',
};
function noticeMobile(contact: Pick<PatientRecipientSource, '_id' | 'mobileNumber'>): string | undefined {
  const fictional = LEARNING_MOBILES[referenceId(contact._id)];
  if (fictional && contact.mobileNumber) {
    try { if (normalizeTo639(contact.mobileNumber) === fictional) return undefined; }
    catch { return undefined; }
  }
  return contact.mobileNumber;
}
export function patientRecipient(patient: PatientRecipientSource | null | undefined): PatientNoticeRecipient | null {
  if (!patient) return null;
  if (!patient.isDependent) return { id: referenceId(patient._id), emailAddress: patient.emailAddress, mobileNumber: noticeMobile(patient) };
  const guardian = patient.guardian;
  if (!guardian || !('role' in guardian) || guardian.role !== 'user' || guardian.status !== UserStatus.CONFIRMED || !guardian.otpVerifiedAt || guardian.isDependent || guardian.loginEnabled === false) return null;
  return { id: referenceId(guardian._id), emailAddress: guardian.emailAddress, mobileNumber: noticeMobile(guardian), patientName: [patient.firstName, patient.lastName].filter(Boolean).join(' ') || 'Child patient' };
}
export async function findPatientRecipient(users: Model<User>, id: unknown, session?: ClientSession): Promise<PatientNoticeRecipient | null> {
  const patient = await users.findById(referenceId(id)).select(PATIENT_RECIPIENT_FIELDS)
    .populate({ path: 'guardian', select: GUARDIAN_RECIPIENT_FIELDS }).session(session ?? null).lean<PatientRecipientSource>();
  return patientRecipient(patient);
}
