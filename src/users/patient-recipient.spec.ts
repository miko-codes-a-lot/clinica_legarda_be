import { Model, Types } from 'mongoose';
import { findPatientRecipient, patientRecipient } from './patient-recipient';
import { User } from './entities/user.entity';
import { UserStatus } from '../_shared/enum/user-status.enum';
const patient = { _id: new Types.ObjectId(), firstName: 'Alice', lastName: 'Child', isDependent: true, emailAddress: 'old-child@clinic-mail.ph' };
const guardian = { _id: new Types.ObjectId(), role: 'user', status: UserStatus.CONFIRMED, otpVerifiedAt: new Date(), emailAddress: 'parent@clinic-mail.ph' };
describe('current appointment notice recipient', () => {
  const learningPatient = { ...patient, _id: new Types.ObjectId('70c400000000000000000006'), isDependent: false, mobileNumber: '+639171113001' };
  it('suppresses the unchanged fictional learning phone while retaining email delivery', () => {
    expect(patientRecipient(learningPatient)).toMatchObject({ emailAddress: patient.emailAddress, mobileNumber: undefined });
  });
  it('allows a learning account to receive SMS after replacing its fictional number', () => {
    expect(patientRecipient({ ...learningPatient, mobileNumber: '+639181234567' })?.mobileNumber).toBe('+639181234567');
  });
  it('does not suppress an ordinary real patient solely because their number matches a fixture', () => {
    expect(patientRecipient({ ...learningPatient, _id: new Types.ObjectId() })?.mobileNumber).toBe(learningPatient.mobileNumber);
  });
  it('also suppresses a fictional learning parent contact for dependent notices', () => {
    expect(patientRecipient({ ...patient, guardian: { ...guardian, _id: learningPatient._id, mobileNumber: learningPatient.mobileNumber } })?.mobileNumber).toBeUndefined();
  });
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
  it('carries an ordinary patient mobile number for text notices', () => {
    expect(patientRecipient({ ...patient, isDependent: false, mobileNumber: '+639171234567' }))
      .toEqual({ id: String(patient._id), emailAddress: patient.emailAddress, mobileNumber: '+639171234567' });
  });
  it('texts the verified parent and never the dependent own number', () => {
    expect(patientRecipient({ ...patient, mobileNumber: '+639170000000', guardian: { ...guardian, mobileNumber: '+639181234567' } }))
      .toEqual({ id: String(guardian._id), emailAddress: guardian.emailAddress, mobileNumber: '+639181234567', patientName: 'Alice Child' });
  });
});

describe('loading the appointment notice recipient', () => {
  // Honours the projection like MongoDB: a field that is not selected is not returned.
  const pick = (doc: Record<string, unknown>, fields: string) =>
    Object.fromEntries(fields.split(' ').filter(field => field in doc).map(field => [field, doc[field]]));
  const usersReturning = (doc: Record<string, unknown> & { guardian?: Record<string, unknown> }) => {
    let projection = '';
    let guardianProjection = '';
    const query = {
      select: (fields: string) => { projection = fields; return query; },
      populate: (options: { select: string }) => { guardianProjection = options.select; return query; },
      session: () => query,
      lean: async () => ({ ...pick(doc, projection), ...(doc.guardian && { guardian: pick(doc.guardian, guardianProjection) }) }),
    };
    return { findById: () => query } as unknown as Model<User>;
  };

  it('loads the mobile number of an ordinary patient', async () => {
    const users = usersReturning({ ...patient, isDependent: false, mobileNumber: '+639171234567' });
    expect(await findPatientRecipient(users, patient._id)).toMatchObject({ mobileNumber: '+639171234567' });
  });
  it('loads the mobile number of the verified parent of a dependent', async () => {
    const users = usersReturning({ ...patient, mobileNumber: '+639170000000', guardian: { ...guardian, mobileNumber: '+639181234567' } });
    expect(await findPatientRecipient(users, patient._id)).toMatchObject({ mobileNumber: '+639181234567' });
  });
});
