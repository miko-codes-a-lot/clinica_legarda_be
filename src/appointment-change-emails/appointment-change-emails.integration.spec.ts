import { ConfigService } from '@nestjs/config';
import { Connection, createConnection, Model } from 'mongoose';
import { AppointmentChangeEmailsService } from './appointment-change-emails.service';
import { AppointmentChangeEmail, AppointmentChangeEmailSchema } from './entities/appointment-change-email.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { MailerService } from '../mailer/mailer.service';
import { SmsService } from '../sms/sms.service';
import { AppointmentChangeSmsService } from './appointment-change-sms.service';

const uri = process.env.TEST_CHANGE_EMAIL_MONGO_URI;
(uri ? describe : describe.skip)('Transactional patient appointment-change mail', () => {
  let db: Connection;
  let appointments: Model<Appointment>;
  let outbox: Model<AppointmentChangeEmail>;
  let users: Model<User>;
  let clinics: Model<Clinic>;
  let catalog: Model<DentalCatalog>;
  let referrals: Model<Referral>;
  let service: AppointmentsService;
  let fixture: { patient: string; dentist: string; clinic: string; service: string };
  const send = jest.fn<Promise<void>, Parameters<MailerService['sendAppointmentChange']>>();
  const text = jest.fn<Promise<void>, Parameters<SmsService['sendAppointmentChange']>>();
  const textWorker = () => new AppointmentChangeSmsService(outbox, users, clinics,
    { sendAppointmentChange: text } as unknown as SmsService, new ConfigService(), appointments);
  const worker = () => new AppointmentChangeEmailsService(outbox, users, clinics,
    { sendAppointmentChange: send } as unknown as MailerService, new ConfigService(), appointments);
  const actor = () => ({ sub: fixture.dentist, role: 'dentist', username: 'Doctor' });
  const reschedule = { date: new Date('2026-10-20'), startTime: '11:00', endTime: '11:30', reason: 'Clinic schedule changed' };
  const book = () => appointments.create({ ...fixture, services: [fixture.service], date: new Date('2026-10-19'),
    startTime: '09:30', endTime: '10:00', status: 'pending', history: [] });
  const event = () => outbox.create({ appointment: '64b000000000000000000009', patient: fixture.patient, clinic: fixture.clinic,
    kind: 'rejected', schedule: { date: '2026-10-19', startTime: '09:30', endTime: '10:00' }, reason: 'Dentist unavailable' });

  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_change_email_spec?replicaSet=clinica-test') throw new Error('Use isolated appointment email test database only.');
    db = await createConnection(uri).asPromise();
    appointments = db.model(Appointment.name, AppointmentSchema); outbox = db.model(AppointmentChangeEmail.name, AppointmentChangeEmailSchema);
    users = db.model(User.name, UserSchema); clinics = db.model(Clinic.name, ClinicSchema);
    catalog = db.model(DentalCatalog.name, DentalCatalogSchema); referrals = db.model(Referral.name, ReferralSchema);
    await outbox.init();
  });
  beforeEach(async () => {
    await Promise.all([appointments.deleteMany({}), outbox.deleteMany({}), users.deleteMany({}), clinics.deleteMany({}), catalog.deleteMany({}), referrals.deleteMany({})]);
    send.mockReset().mockResolvedValue(undefined); text.mockReset().mockResolvedValue(undefined);
    const hours = ['monday', 'tuesday'].map(day => ({ day, startTime: '09:00', endTime: '16:00' }));
    const clinic = await clinics.create({ name: 'Email test clinic', address: 'Test address', operatingHours: hours });
    const patient = await users.create({ role: 'user', status: 'confirmed', emailAddress: 'patient@clinic-mail.ph', mobileNumber: '+639171234567' });
    const dentist = await users.create({ role: 'dentist', status: 'confirmed', clinics: [clinic._id], operatingHours: hours });
    const treatment = await catalog.create({ name: 'Test treatment', duration: 30, clinics: [clinic._id] });
    fixture = { patient: patient.id, dentist: dentist.id, clinic: clinic.id, service: treatment.id };
    service = new AppointmentsService(appointments, new AppointmentSchedulingService(appointments, users, clinics, catalog), referrals, users,
      undefined, undefined, outbox);
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  afterAll(async () => { await db?.dropDatabase(); await db?.close(); });

  it('waits for staff approval then delivers one combined email and text across workers and restarts', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'performance', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-10-18T00:00:00Z'));
    const appointment = await book();
    await service.approve(appointment.id, actor());
    await outbox.deleteMany({}); // The original booking confirmation is unrelated to its subsequent change.
    const revised = await service.reschedule(appointment.id, reschedule, actor());
    expect(revised.status).toBe('pending');
    expect(JSON.parse(JSON.stringify(revised))).not.toHaveProperty('pendingRescheduleNotice');
    expect(await outbox.countDocuments()).toBe(0);
    await worker().sendPending(); await textWorker().sendPending();
    expect(send).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled();
    jest.setSystemTime(new Date('2026-10-19T00:00:00Z')); // Approval can be a day later; SMS age starts at approval.
    await service.approve(appointment.id, actor());
    await expect(service.approve(appointment.id, actor())).rejects.toThrow();
    expect(await outbox.countDocuments()).toBe(1);
    const queued = await outbox.findOne();
    expect(queued?.toObject()).toMatchObject({ kind: 'confirmed', reason: 'Clinic schedule changed',
      previousSchedule: { date: '2026-10-19', startTime: '09:30', endTime: '10:00' },
      schedule: { date: '2026-10-20', startTime: '11:00', endTime: '11:30' } });
    await Promise.all([worker().sendPending(), worker().sendPending(), textWorker().sendPending(), textWorker().sendPending()]);
    await worker().sendPending(); await textWorker().sendPending();
    for (const channel of [send, text]) {
      expect(channel).toHaveBeenCalledTimes(1);
      expect(channel.mock.calls[0][1]).toMatchObject({ kind: 'confirmed', reason: 'Clinic schedule changed',
        previousSchedule: { date: '2026-10-19', startTime: '09:30', endTime: '10:00' },
        date: '2026-10-20', startTime: '11:00', arrivalDeadline: new Date('2026-10-20T03:20:00Z') });
    }
  });

  it('persists rejection mail only for a successful staff decision', async () => {
    const appointment = await book();
    await expect(service.reject(appointment.id, { sub: fixture.patient, role: 'user' }, 'Dentist unavailable')).rejects.toThrow();
    expect(await outbox.countDocuments()).toBe(0);
    await service.reject(appointment.id, actor(), 'Dentist unavailable');
    await expect(service.reject(appointment.id, actor(), 'Duplicate click')).rejects.toThrow();
    expect(await outbox.countDocuments()).toBe(1);
    await worker().sendPending();
    expect(send).toHaveBeenCalledWith('patient@clinic-mail.ph', expect.objectContaining({ kind: 'rejected', reason: 'Dentist unavailable' }));
  });

  it('persists approval mail once for a committed transition and supplies its arrival deadline', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-18T00:00:00Z').getTime());
    const appointment = await book();
    await service.approve(appointment.id, actor());
    await expect(service.approve(appointment.id, actor())).rejects.toThrow();
    expect(await outbox.countDocuments()).toBe(1);
    await worker().sendPending();
    expect(send).toHaveBeenCalledWith('patient@clinic-mail.ph', expect.objectContaining({
      kind: 'confirmed', arrivalDeadline: new Date('2026-10-19T01:50:00Z'),
    }));
    expect(JSON.stringify(await outbox.findOne())).not.toContain('CLINICAL');
  });

  it('notifies a patient of their own cancellation and does not repeat it', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-18T00:00:00Z').getTime());
    const appointment = await book();
    // The production create path persists the creator; this raw fixture must do so too.
    await appointments.collection.updateOne({ _id: appointment._id }, { $set: { createdBy: appointment.patient } });
    await service.cancel(appointment.id, { sub: fixture.patient, role: 'user' }, 'Family emergency');
    await expect(service.cancel(appointment.id, { sub: fixture.patient, role: 'user' }, 'Again')).rejects.toThrow();
    expect(await outbox.countDocuments()).toBe(1);
    await worker().sendPending();
    expect(send).toHaveBeenCalledWith('patient@clinic-mail.ph', expect.objectContaining({ kind: 'cancelled', reason: 'Family emergency' }));
  });

  it.each(['cancelled', 'rescheduled'])('suppresses an approval after the appointment was %s', async (change) => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-18T00:00:00Z').getTime());
    const appointment = await book();
    await service.approve(appointment.id, actor());
    await appointments.updateOne({ _id: appointment._id }, change === 'cancelled'
      ? { status: 'cancelled' } : { date: reschedule.date, startTime: reschedule.startTime, endTime: reschedule.endTime });
    await worker().sendPending();
    expect(send).not.toHaveBeenCalled();
    expect(await outbox.countDocuments({ skippedAt: { $exists: true } })).toBe(1);
  });

  it('rolls approval and its history back when its outbox write fails', async () => {
    const appointment = await book();
    jest.spyOn(outbox, 'create').mockRejectedValueOnce(new Error('Outbox unavailable'));
    await expect(service.approve(appointment.id, actor())).rejects.toThrow('Outbox unavailable');
    const current = await appointments.findById(appointment._id);
    expect(current?.status).toBe('pending'); expect(current?.history).toHaveLength(0);
  });

  it('does not enqueue patient self-reschedules', async () => {
    const appointment = await book();
    await service.reschedule(appointment.id, reschedule, { sub: fixture.patient, role: 'user' });
    expect(await outbox.countDocuments()).toBe(0);
  });

  it('keeps the original patient-visible schedule across multiple staff changes and note edits', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-18T00:00:00Z').getTime());
    const appointment = await book();
    await service.reschedule(appointment.id, reschedule, actor());
    await service.reschedule(appointment.id, { ...reschedule, startTime: '12:00', endTime: '12:30', reason: 'Final adjustment' }, actor());
    await service.update(appointment.id, { ...fixture, services: [fixture.service], date: reschedule.date,
      startTime: '12:00', endTime: '12:30', notes: { clinicNotes: 'PRIVATE CLINICAL NOTE' } }, actor());
    await service.update(appointment.id, { ...fixture, services: [fixture.service], date: reschedule.date,
      startTime: '13:00', endTime: '13:30' }, actor());
    await service.approve(appointment.id, actor());
    await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toMatchObject({ kind: 'confirmed', startTime: '13:00', reason: 'Final adjustment',
      previousSchedule: { date: '2026-10-19', startTime: '09:30', endTime: '10:00' } });
    expect(JSON.stringify(await outbox.findOne())).not.toContain('PRIVATE CLINICAL NOTE');
  });

  it('uses ordinary confirmation when a patient changes a schedule after staff', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-18T00:00:00Z').getTime());
    const appointment = await book();
    await service.reschedule(appointment.id, reschedule, actor());
    await service.reschedule(appointment.id, { ...reschedule, startTime: '12:00', endTime: '12:30', reason: 'Patient request' },
      { sub: fixture.patient, role: 'user' });
    await service.approve(appointment.id, actor());
    await worker().sendPending(); await textWorker().sendPending();
    for (const channel of [send, text]) {
      expect(channel).toHaveBeenCalledTimes(1);
      expect(channel.mock.calls[0][1]).toMatchObject({ kind: 'confirmed', startTime: '12:00' });
      expect(channel.mock.calls[0][1].previousSchedule).toBeUndefined();
      expect(channel.mock.calls[0][1].reason).toBeUndefined();
    }
  });

  it('defers a staff schedule edit until approval and preserves both schedules without clinical notes', async () => {
    const appointment = await book();
    await service.update(appointment.id, { ...fixture, services: [fixture.service], date: reschedule.date,
      startTime: reschedule.startTime, endTime: reschedule.endTime, notes: { clinicNotes: 'PRIVATE CLINICAL NOTE' } }, actor());
    expect(await outbox.countDocuments()).toBe(0);
    await service.approve(appointment.id, actor());
    const queued = await outbox.findOne();
    expect(queued?.toObject()).toMatchObject({ kind: 'confirmed', schedule: { date: '2026-10-20' },
      previousSchedule: { date: '2026-10-19', startTime: '09:30', endTime: '10:00' } });
    expect(JSON.stringify(queued)).not.toContain('PRIVATE CLINICAL NOTE');
  });

  it('sends only a rejection if a staff reschedule is declined instead of approved', async () => {
    const appointment = await book();
    await service.reschedule(appointment.id, reschedule, actor());
    await service.reject(appointment.id, actor(), 'No longer available');
    await worker().sendPending(); await textWorker().sendPending();
    for (const channel of [send, text]) {
      expect(channel).toHaveBeenCalledTimes(1);
      expect(channel.mock.calls[0][1]).toMatchObject({ kind: 'rejected' });
      expect(channel.mock.calls[0][1].previousSchedule).toBeUndefined();
    }
    expect(await outbox.countDocuments()).toBe(1);
  });

  it.each([false, true])('does not copy the former patient schedule/reason when reassigned (time changed: %s)', async (changeTime) => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-18T00:00:00Z').getTime());
    const appointment = await book();
    await service.reschedule(appointment.id, reschedule, actor());
    const replacement = await users.create({ role: 'user', status: 'confirmed', emailAddress: 'replacement@clinic-mail.ph' });
    const admin = { sub: fixture.dentist, role: 'super-admin' };
    await service.update(appointment.id, { ...fixture, patient: replacement.id, services: [fixture.service], date: reschedule.date,
      startTime: changeTime ? '12:00' : '11:00', endTime: changeTime ? '12:30' : '11:30' }, admin);
    await service.approve(appointment.id, admin); await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('replacement@clinic-mail.ph');
    expect(send.mock.calls[0][1].previousSchedule).toBeUndefined();
    expect(send.mock.calls[0][1].reason).toBeUndefined();
  });

  it('does not email an unchanged schedule when staff only edit appointment notes', async () => {
    const appointment = await book();
    await service.update(appointment.id, { ...fixture, services: [fixture.service], date: new Date('2026-10-19'),
      startTime: '09:30', endTime: '10:00', notes: { clinicNotes: 'PRIVATE CLINICAL NOTE' } }, actor());
    expect(await outbox.countDocuments()).toBe(0);
  });

  it('retains the pending reschedule for retry if approval and its combined notice roll back', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-18T00:00:00Z').getTime());
    const appointment = await book();
    await service.reschedule(appointment.id, reschedule, actor());
    const store = jest.spyOn(outbox, 'create').mockRejectedValueOnce(new Error('Outbox write failure'));
    await expect(service.approve(appointment.id, actor())).rejects.toThrow('Outbox write failure');
    store.mockRestore();
    const current = await appointments.findById(appointment._id);
    expect(current?.status).toBe('pending'); expect(current?.history).toHaveLength(1);
    expect(await outbox.countDocuments()).toBe(0);
    await service.approve(appointment.id, actor()); await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toMatchObject({ kind: 'confirmed', reason: 'Clinic schedule changed',
      previousSchedule: { date: '2026-10-19', startTime: '09:30', endTime: '10:00' } });
  });

  it('retries a failed delivery after its delay, retaining the event snapshot', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'performance', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-10-13T00:00:00Z'));
    await event(); send.mockRejectedValueOnce(new Error('Provider unavailable'));
    await worker().sendPending(); await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await outbox.countDocuments({ sentAt: { $exists: true } })).toBe(0);
    jest.setSystemTime(new Date('2026-10-13T00:10:00Z')); await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await outbox.countDocuments({ sentAt: { $exists: true } })).toBe(1);
  });

  it('records a skipped demo destination without contacting Gmail or marking it sent', async () => {
    await users.updateOne({ _id: fixture.patient }, { emailAddress: 'patient@example.test' });
    const queued = await event();
    await worker().sendPending();
    const stored = await outbox.findById(queued._id);
    expect(stored?.skippedAt).toBeInstanceOf(Date);
    expect(stored?.sentAt).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('recovers an expired claim and skips missing or invalid email without exposing contacts', async () => {
    const queued = await event();
    await outbox.updateOne({ _id: queued._id }, { lockedUntil: new Date(Date.now() + 60_000), leaseToken: 'other-worker' });
    await worker().sendPending(); expect(send).not.toHaveBeenCalled();
    await outbox.updateOne({ _id: queued._id }, { lockedUntil: new Date(Date.now() - 1) });
    await worker().sendPending(); expect(send).toHaveBeenCalledTimes(1);
    await event(); await users.updateOne({ _id: fixture.patient }, { emailAddress: 'invalid\r\nBcc: attacker@example.test' });
    await worker().sendPending(); expect(send).toHaveBeenCalledTimes(1);
    expect(await outbox.countDocuments({ skippedAt: { $exists: true } })).toBe(1);
  });
});
