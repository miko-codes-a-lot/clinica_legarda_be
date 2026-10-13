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
  const worker = () => new AppointmentChangeEmailsService(outbox, users, clinics,
    { sendAppointmentChange: send } as unknown as MailerService, new ConfigService());
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
    send.mockReset().mockResolvedValue(undefined);
    const hours = ['monday', 'tuesday'].map(day => ({ day, startTime: '09:00', endTime: '16:00' }));
    const clinic = await clinics.create({ name: 'Email test clinic', address: 'Test address', operatingHours: hours });
    const patient = await users.create({ role: 'user', status: 'confirmed', emailAddress: 'patient@example.test' });
    const dentist = await users.create({ role: 'dentist', status: 'confirmed', clinics: [clinic._id], operatingHours: hours });
    const treatment = await catalog.create({ name: 'Test treatment', duration: 30, clinics: [clinic._id] });
    fixture = { patient: patient.id, dentist: dentist.id, clinic: clinic.id, service: treatment.id };
    service = new AppointmentsService(appointments, new AppointmentSchedulingService(appointments, users, clinics, catalog), referrals, users,
      undefined, undefined, outbox);
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  afterAll(async () => { await db?.dropDatabase(); await db?.close(); });

  it('commits one reschedule snapshot with previous/new schedule and delivers once across workers/restarts', async () => {
    const appointment = await book();
    await service.reschedule(appointment.id, reschedule, actor());
    expect(await outbox.countDocuments()).toBe(1);
    const queued = await outbox.findOne();
    expect(queued?.toObject()).toMatchObject({ kind: 'rescheduled', reason: 'Clinic schedule changed',
      previousSchedule: { date: '2026-10-19', startTime: '09:30', endTime: '10:00' },
      schedule: { date: '2026-10-20', startTime: '11:00', endTime: '11:30' } });
    await Promise.all([worker().sendPending(), worker().sendPending()]);
    await worker().sendPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toMatchObject(['patient@example.test', { kind: 'rescheduled', clinicName: 'Email test clinic', date: '2026-10-20' }]);
  });

  it('persists rejection mail only for a successful staff decision', async () => {
    const appointment = await book();
    await expect(service.reject(appointment.id, { sub: fixture.patient, role: 'user' }, 'Dentist unavailable')).rejects.toThrow();
    expect(await outbox.countDocuments()).toBe(0);
    await service.reject(appointment.id, actor(), 'Dentist unavailable');
    await expect(service.reject(appointment.id, actor(), 'Duplicate click')).rejects.toThrow();
    expect(await outbox.countDocuments()).toBe(1);
    await worker().sendPending();
    expect(send).toHaveBeenCalledWith('patient@example.test', expect.objectContaining({ kind: 'rejected', reason: 'Dentist unavailable' }));
  });

  it('does not enqueue patient self-reschedules', async () => {
    const appointment = await book();
    await service.reschedule(appointment.id, reschedule, { sub: fixture.patient, role: 'user' });
    expect(await outbox.countDocuments()).toBe(0);
  });

  it('also queues a staff edit that changes a pending appointment schedule without copying clinical notes', async () => {
    const appointment = await book();
    await service.update(appointment.id, { ...fixture, services: [fixture.service], date: reschedule.date,
      startTime: reschedule.startTime, endTime: reschedule.endTime, notes: { clinicNotes: 'PRIVATE CLINICAL NOTE' } }, actor());
    expect(await outbox.countDocuments()).toBe(1);
    const queued = await outbox.findOne();
    expect(queued?.schedule.date).toBe('2026-10-20');
    expect(JSON.stringify(queued)).not.toContain('PRIVATE CLINICAL NOTE');
  });

  it('does not email an unchanged schedule when staff only edit appointment notes', async () => {
    const appointment = await book();
    await service.update(appointment.id, { ...fixture, services: [fixture.service], date: new Date('2026-10-19'),
      startTime: '09:30', endTime: '10:00', notes: { clinicNotes: 'PRIVATE CLINICAL NOTE' } }, actor());
    expect(await outbox.countDocuments()).toBe(0);
  });

  it('rolls back the appointment when its transactional email snapshot cannot be stored', async () => {
    const appointment = await book();
    const store = jest.spyOn(outbox, 'create').mockRejectedValueOnce(new Error('Outbox write failure'));
    await expect(service.reschedule(appointment.id, reschedule, actor())).rejects.toThrow('Outbox write failure');
    store.mockRestore();
    const current = await appointments.findById(appointment._id);
    expect(current?.date.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(current?.startTime).toBe('09:30'); expect(current?.history).toHaveLength(0);
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
