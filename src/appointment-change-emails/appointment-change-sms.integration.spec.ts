import { ConfigService } from '@nestjs/config';
import { Connection, createConnection, Model, Types } from 'mongoose';
import { AppointmentChangeSmsService } from './appointment-change-sms.service';
import { AppointmentChangeEmail, AppointmentChangeEmailSchema } from './entities/appointment-change-email.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { SmsService } from '../sms/sms.service';

const uri = process.env.TEST_CHANGE_SMS_MONGO_URI;
(uri ? describe : describe.skip)('Transactional patient appointment-change texts', () => {
  let db: Connection;
  let appointments: Model<Appointment>;
  let outbox: Model<AppointmentChangeEmail>;
  let users: Model<User>;
  let clinics: Model<Clinic>;
  let fixture: { patient: string; clinic: string };
  const send = jest.fn<Promise<void>, Parameters<SmsService['sendAppointmentChange']>>();
  const worker = () => new AppointmentChangeSmsService(outbox, users, clinics,
    { sendAppointmentChange: send } as unknown as SmsService, new ConfigService(), appointments);
  const event = (extra: Record<string, unknown> = {}) => outbox.create({ appointment: new Types.ObjectId(), patient: fixture.patient, clinic: fixture.clinic,
    kind: 'rejected', schedule: { date: '2026-10-19', startTime: '09:30', endTime: '10:00' }, reason: 'Dentist unavailable', ...extra });
  const confirmed = () => appointments.create({ clinic: fixture.clinic, patient: fixture.patient, dentist: new Types.ObjectId(),
    date: new Date('2026-10-21'), startTime: '09:00', endTime: '09:30', status: 'confirmed' });
  const confirmation = (appointment: string) => event({ appointment, kind: 'confirmed', schedule: { date: '2026-10-21', startTime: '09:00', endTime: '09:30' } });
  const clock = (iso: string) => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'performance', 'queueMicrotask'] });
    jest.setSystemTime(new Date(iso));
  };

  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_change_sms_spec?replicaSet=clinica-test') throw new Error('Use isolated appointment text test database only.');
    db = await createConnection(uri).asPromise();
    appointments = db.model(Appointment.name, AppointmentSchema); outbox = db.model(AppointmentChangeEmail.name, AppointmentChangeEmailSchema);
    users = db.model(User.name, UserSchema); clinics = db.model(Clinic.name, ClinicSchema);
    await outbox.init();
  });
  beforeEach(async () => {
    await Promise.all([appointments.deleteMany({}), outbox.deleteMany({}), users.deleteMany({}), clinics.deleteMany({})]);
    send.mockReset().mockResolvedValue(undefined);
    const hours = ['monday', 'tuesday'].map(day => ({ day, startTime: '09:00', endTime: '16:00' }));
    const clinic = await clinics.create({ name: 'Text test clinic', address: 'Test address', operatingHours: hours });
    const patient = await users.create({ role: 'user', status: 'confirmed', emailAddress: 'patient@clinic-mail.ph', mobileNumber: '+639171234567' });
    fixture = { patient: patient.id, clinic: clinic.id };
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  afterAll(async () => { await db?.dropDatabase(); await db?.close(); });

  it('texts an event once across concurrent workers and restarts, with its snapshot', async () => {
    await event({ kind: 'cancelled', reason: 'Family emergency' });
    await Promise.all([worker().sendPending(), worker().sendPending()]);
    await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toMatchObject(['+639171234567', { kind: 'cancelled', clinicName: 'Text test clinic', clinicAddress: 'Test address',
      date: '2026-10-19', startTime: '09:30', endTime: '10:00', reason: 'Family emergency' }]);
    expect(await outbox.countDocuments({ smsSentAt: { $exists: true } })).toBe(1);
  });

  it('texts a patient with no usable email without touching email delivery', async () => {
    await users.updateOne({ _id: fixture.patient }, { $unset: { emailAddress: 1 } });
    const queued = await event();
    await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(1);
    const stored = await outbox.findById(queued._id);
    expect(stored?.smsSentAt).toBeInstanceOf(Date);
    expect(stored?.sentAt).toBeUndefined();
    expect(stored?.skippedAt).toBeUndefined();
  });

  it('still texts an event whose email was already delivered', async () => {
    const queued = await event({ sentAt: new Date() });
    await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await outbox.findById(queued._id))?.smsSentAt).toBeInstanceOf(Date);
  });

  it.each([undefined, '', '12345', '+639171234567,+639181234567'])('skips a patient whose mobile number is %p, leaving email delivery untouched', async (mobileNumber) => {
    await users.collection.updateOne({ _id: new Types.ObjectId(fixture.patient) }, mobileNumber === undefined ? { $unset: { mobileNumber: 1 } } : { $set: { mobileNumber } });
    const queued = await event();
    await worker().sendPending();
    expect(send).not.toHaveBeenCalled();
    const stored = await outbox.findById(queued._id);
    expect(stored?.smsSkippedAt).toBeInstanceOf(Date);
    expect(stored?.smsSentAt).toBeUndefined();
    expect(stored?.sentAt).toBeUndefined();
    expect(stored?.skippedAt).toBeUndefined();
  });

  it('texts the verified parent of a dependent and names the child', async () => {
    const parent = await users.create({ role: 'user', status: 'confirmed', otpVerifiedAt: new Date(), emailAddress: 'parent@clinic-mail.ph', mobileNumber: '+639181234567' });
    const child = await users.create({ role: 'user', status: 'confirmed', isDependent: true, guardian: parent._id,
      firstName: 'Alice', lastName: 'Child', mobileNumber: '+639170000000' });
    await event({ patient: child._id });
    await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('+639181234567', expect.objectContaining({ patientName: 'Alice Child' }));
  });

  it('retries a failed text after its delay, retaining the event snapshot', async () => {
    clock('2026-10-13T00:00:00Z');
    await event(); send.mockRejectedValueOnce(new Error('Provider unavailable'));
    await worker().sendPending(); await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await outbox.countDocuments({ smsSentAt: { $exists: true } })).toBe(0);
    jest.setSystemTime(new Date('2026-10-13T00:10:00Z')); await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await outbox.countDocuments({ smsSentAt: { $exists: true } })).toBe(1);
  });

  it('recovers an expired claim but leaves a live claim of another worker alone', async () => {
    const queued = await event();
    await outbox.updateOne({ _id: queued._id }, { smsLockedUntil: new Date(Date.now() + 60_000), smsLeaseToken: 'other-worker' });
    await worker().sendPending(); expect(send).not.toHaveBeenCalled();
    await outbox.updateOne({ _id: queued._id }, { smsLockedUntil: new Date(Date.now() - 1) });
    await worker().sendPending(); expect(send).toHaveBeenCalledTimes(1);
  });

  it('texts a valid confirmation with its arrival deadline', async () => {
    clock('2026-10-20T00:00:00Z');
    const appointment = await confirmed();
    await confirmation(appointment.id);
    await worker().sendPending();
    expect(send).toHaveBeenCalledWith('+639171234567', expect.objectContaining({ kind: 'confirmed', arrivalDeadline: new Date('2026-10-21T01:20:00Z') }));
  });

  it.each(['cancelled', 'rescheduled'])('suppresses a confirmation text after the appointment was %s', async (change) => {
    clock('2026-10-20T00:00:00Z');
    const appointment = await confirmed();
    await confirmation(appointment.id);
    await appointments.updateOne({ _id: appointment._id }, change === 'cancelled' ? { status: 'cancelled' } : { date: new Date('2026-10-22') });
    await worker().sendPending();
    expect(send).not.toHaveBeenCalled();
    expect(await outbox.countDocuments({ smsSkippedAt: { $exists: true } })).toBe(1);
  });

  it('never replays events older than a day, so switching texts on cannot announce old changes', async () => {
    const old = await event({ reason: 'Old' });
    const recent = await event({ reason: 'Recent' });
    await outbox.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    await outbox.collection.updateOne({ _id: recent._id }, { $set: { createdAt: new Date(Date.now() - 23 * 3_600_000) } });
    await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('+639171234567', expect.objectContaining({ reason: 'Recent' }));
    const stored = await outbox.findById(old._id);
    expect(stored?.smsSentAt).toBeUndefined();
    expect(stored?.smsSkippedAt).toBeUndefined();
  });
});
