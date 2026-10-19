import { Types } from 'mongoose';
import { patientRecipient } from './patient-recipient';
import { UserStatus } from '../_shared/enum/user-status.enum';
const patient = { _id: new Types.ObjectId(), firstName: 'Alice', lastName: 'Child', isDependent: true, emailAddress: 'old-child@clinic-mail.ph' };
const guardian = { _id: new Types.ObjectId(), role: 'user', status: UserStatus.CONFIRMED, otpVerifiedAt: new Date(), emailAddress: 'parent@clinic-mail.ph' };
describe('current appointment notice recipient', () => {
  it('uses the verified current parent and names the child', () => {
    expect(patientRecipient({ ...patient, guardian })).toEqual({ id: String(guardian._id), emailAddress: guardian.emailAddress, patientName: 'Alice Child' });
  });
  it('never falls back to a dependent email after unlinking or loss of parent verification', () => {
    expect(patientRecipient(patient)).toBeNull();
    expect(patientRecipient({ ...patient, guardian: guardian._id })).toBeNull();
    expect(patientRecipient({ ...patient, guardian: { ...guardian, otpVerifiedAt: undefined } })).toBeNull();
    expect(patientRecipient({ ...patient, guardian: { ...guardian, isDependent: true } })).toBeNull();
  });
  it('preserves ordinary patient notices', () => {
    expect(patientRecipient({ ...patient, isDependent: false })).toEqual({ id: String(patient._id), emailAddress: patient.emailAddress });
  });
});
