import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from '../auth/auth.guard';
import { DependentsController } from './dependents.controller';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppointmentChangeEmail, AppointmentChangeEmailSchema } from '../appointment-change-emails/entities/appointment-change-email.entity';
import { AppointmentChangeEmailsService } from '../appointment-change-emails/appointment-change-emails.service';
import { AppointmentReminder, AppointmentReminderSchema } from '../appointment-reminders/entities/appointment-reminder.entity';
import { AppointmentRemindersService } from '../appointment-reminders/appointment-reminders.service';
import { MailerService } from '../mailer/mailer.service';
import { ConfigService } from '@nestjs/config';
import { PatientCareService } from '../care/patient-care.service';
import { TreatmentCase, TreatmentCaseSchema } from '../care/entities/treatment-case.entity';
import { createConnection, Connection, Model } from 'mongoose';
import { DependentsService } from './dependents.service';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { UserActor } from '../auth/role-policy';

const uri = process.env.CLINICA_PANELIST_TEST_URI;
(uri ? describe : describe.skip)('Parent and child patient boundaries', () => {
  let db: Connection, users: Model<User>, clinics: Model<Clinic>, appointments: Model<Appointment>, visits: Model<Visit>;
  let catalog: Model<DentalCatalog>, referrals: Model<Referral>, profiles: UsersService, dependents: DependentsService, auth: AuthService, bookings: AppointmentsService;
  let outbox: Model<AppointmentChangeEmail>, reminders: Model<AppointmentReminder>, cases: Model<TreatmentCase>;
  let parent: string, other: string, dentist: string, clinic: string, service: string;
  const actor = (id = parent): Promise<UserActor> => auth.resolveActor({ sub: id, role: 'user' });
  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_panelist_spec?replicaSet=clinica-test') throw new Error('Use isolated panelist database only.');
    db = await createConnection(uri).asPromise();
    outbox = db.model(AppointmentChangeEmail.name, AppointmentChangeEmailSchema); reminders = db.model(AppointmentReminder.name, AppointmentReminderSchema); cases = db.model(TreatmentCase.name, TreatmentCaseSchema); users = db.model(User.name, UserSchema); clinics = db.model(Clinic.name, ClinicSchema);
    appointments = db.model(Appointment.name, AppointmentSchema); visits = db.model(Visit.name, VisitSchema); catalog = db.model(DentalCatalog.name, DentalCatalogSchema); referrals = db.model(Referral.name, ReferralSchema);
  });
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-20T02:00:00Z').getTime());
    await Promise.all(Object.values(db.models).map(m => m.deleteMany({})));
    const people = await users.create(['Parent','Other'].map((firstName, index) => ({ firstName, lastName: 'Test', role: 'user', status: 'confirmed', emailAddress: `parent${index}@clinic-mail.ph`, otpVerifiedAt: new Date(), username: `parent${index}` })));
    parent = people[0].id; other = people[1].id;
    const hours = [{ day: 'wednesday', startTime: '08:00', endTime: '18:00' }];
    clinic = (await clinics.create({ name: 'Parent clinic', operatingHours: hours })).id;
    dentist = (await users.create({ role: 'dentist', status: 'confirmed', clinics: [clinic], operatingHours: hours, appointmentBufferMinutes: 0 })).id;
    service = (await catalog.create({ name: 'Consultation', duration: 30 })).id;
    profiles = new UsersService(users, clinics, appointments, visits);
    dependents = new DependentsService(users, appointments, visits);
    auth = new AuthService({} as JwtService, profiles, {} as import('../otp/otp.service').OtpService, {} as import('../mailer/mailer.service').MailerService);
    bookings = new AppointmentsService(appointments, new AppointmentSchedulingService(appointments, users, clinics, catalog), referrals, users, undefined, visits);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await db?.dropDatabase(); await db?.close(); });
  const child = (name = 'Child') => dependents.create({ sub: parent, role: 'user' }, { firstName: name, lastName: 'Test', birthDate: '2018-02-28' });
  const payload = (patient: string, startTime = '09:00', endTime = '09:30') => ({ patient, dentist, clinic, services: [service], date: new Date('2026-10-21'), startTime, endTime });

  it('creates a distinct child identity without credentials or child OTP proof and books under the child name', async () => {
    const a = await child('Alice'), b = await child('Bob');
    expect(a._id.toString()).not.toBe(b._id.toString());
    const stored = await users.findById(a._id).select('+password');
    expect(stored).toMatchObject({ isDependent: true, loginEnabled: false, verificationSource: 'guardian' });
    expect(stored?.otpVerifiedAt).toBeUndefined(); expect(stored?.username).toBeUndefined(); expect(stored?.password).toBeUndefined(); expect(stored?.emailAddress).toBeUndefined();
    const booked = await bookings.create(payload(a._id.toString()), await actor());
    expect(String(booked.patient._id)).toBe(String(a._id)); expect(String(booked.createdBy?._id)).toBe(parent);
    await bookings.create(payload(b._id.toString(), '10:00', '10:30'), await actor());
    expect(await bookings.findAll(await actor(), a._id.toString())).toHaveLength(1);
    await expect(bookings.create(payload(a._id.toString(), '11:00','11:30'), await actor(other))).rejects.toThrow();
    await bookings.create(payload(parent, '12:00','12:30'), await actor());
  });
  it('revokes old-session reads and stale in-flight writes immediately after unlinking', async () => {
    const a = await child(); const stale = await actor(); const booking = await bookings.create(payload(String(a._id)), stale);
    await dependents.unlink({ sub: parent, role: 'user' }, String(a._id));
    expect(await bookings.findAll(await actor())).toHaveLength(0);
    await expect(bookings.findOne(String(booking._id), await actor())).rejects.toThrow();
    await expect(bookings.cancel(String(booking._id), stale, 'Changed plans')).rejects.toThrow();
    await expect(bookings.create(payload(String(a._id), '10:00', '10:30'), stale)).rejects.toThrow();
    expect(await appointments.countDocuments()).toBe(1);
    await expect(profiles.delete(String(a._id), { sub: other, role: 'super-admin' })).rejects.toThrow();
  });
  it('sends child approval, cancellation and reminders to the current parent only', async () => {
    const a = await child('Alice'), patient = String(a._id);
    const booked = await bookings.create(payload(patient), await actor());
    await appointments.updateOne({ _id: booked._id }, { $set: { status: 'confirmed' } });
    const sendAppointmentChange = jest.fn().mockResolvedValue(undefined), sendAppointmentReminder = jest.fn().mockResolvedValue(undefined);
    const mailer = { sendAppointmentChange, sendAppointmentReminder } as unknown as MailerService;
    const changes = new AppointmentChangeEmailsService(outbox, users, clinics, mailer, {} as ConfigService, appointments);
    await outbox.create({ appointment: booked._id, patient, clinic, kind: 'confirmed', eventKey: 'child-confirm', schedule: { date: '2026-10-21', startTime: '09:00', endTime: '09:30' } });
    await changes.sendPending();
    expect(sendAppointmentChange).toHaveBeenCalledWith('parent0@clinic-mail.ph', expect.objectContaining({ kind: 'confirmed', patientName: 'Alice Test' }));
    const worker = new AppointmentRemindersService(appointments, reminders, mailer, {} as ConfigService);
    await worker.sendDueReminders();
    expect(sendAppointmentReminder).toHaveBeenCalledWith('parent0@clinic-mail.ph', expect.objectContaining({ patientName: 'Alice Test' }));
    await appointments.updateOne({ _id: booked._id }, { $set: { status: 'cancelled' } });
    await outbox.create({ appointment: booked._id, patient, clinic, kind: 'cancelled', eventKey: 'child-cancel', schedule: { date: '2026-10-21', startTime: '09:00', endTime: '09:30' } });
    await changes.sendPending(); expect(sendAppointmentChange).toHaveBeenCalledTimes(2);
    await dependents.unlink({ sub: parent, role: 'user' }, patient);
    await outbox.create({ appointment: booked._id, patient, clinic, kind: 'cancelled', eventKey: 'child-unlinked', schedule: { date: '2026-10-21', startTime: '09:00', endTime: '09:30' } });
    await changes.sendPending(); expect(sendAppointmentChange).toHaveBeenCalledTimes(2);
  });
  it('keeps siblings’ published care separate and excludes internal notes', async () => {
    const a = await child('Alice'), b = await child('Bob');
    await visits.create([{ patient: a._id, dentist, clinic, date: '2026-10-21', checkedInAt: new Date(), state: 'completed', purpose: 'consultation', createdBy: parent, summary: 'Alice summary', assessment: 'PRIVATE_ALICE' }, { patient: b._id, dentist, clinic, date: '2026-10-21', checkedInAt: new Date(), state: 'completed', purpose: 'consultation', createdBy: parent, summary: 'Bob summary' }]);
    const care = new PatientCareService(visits, cases, appointments);
    const result = await care.ownRecord(await actor(), String(a._id));
    expect(result.visits).toHaveLength(1); expect(JSON.stringify(result)).toContain('Alice summary'); expect(JSON.stringify(result)).not.toMatch(/PRIVATE_ALICE|Bob summary/);
    await dependents.unlink({ sub: parent, role: 'user' }, String(a._id));
    await expect(care.ownRecord(await actor(), String(a._id))).rejects.toThrow();
  });
  it('blocks dependent authentication and parent deletion and ignores forged public relationship flags', async () => {
    const a = await child();
    await users.updateOne({ _id: a._id }, { $set: { username: 'accidental', emailAddress: 'accidental@clinic-mail.ph', password: 'unused' } });
    expect(await profiles.findForSignIn('accidental')).toBeNull(); expect(await profiles.findForResetOtp('accidental@clinic-mail.ph')).toBeNull();
    await expect(auth.resolveActor({ sub: String(a._id), role: 'user' })).rejects.toThrow();
    await expect(profiles.delete(parent, { sub: other, role: 'super-admin' })).rejects.toThrow();
    await expect(profiles.upsert({ firstName: 'Parent', lastName: 'Test', username: 'parent0', emailAddress: 'parent0@clinic-mail.ph', mobileNumber: '+639171234567', address: 'Manila', role: 'dentist', clinics: [clinic] }, parent, { sub: other, role: 'super-admin' })).rejects.toThrow();
    const registered = await profiles.registerPatient(Object.assign({ firstName: 'Public', lastName: 'User', username: 'public', emailAddress: 'public@clinic-mail.ph', mobileNumber: '+639171234568', address: 'Manila', role: 'user' }, { guardian: parent, isDependent: true, loginEnabled: false }));
    expect(registered?.isDependent).not.toBe(true); expect(registered?.guardian).toBeUndefined();
  });
  it('validates HTTP input and resolves current parent access instead of trusting token claims', async () => {
    const module = await Test.createTestingModule({ controllers: [DependentsController], providers: [
      { provide: DependentsService, useValue: dependents }, { provide: AuthService, useValue: { verifyJwt: async (token: string) => ({ sub: token, role: 'super-admin', patientIds: [other] }), resolveActor: (input: UserActor) => auth.resolveActor(input) } }, { provide: APP_GUARD, useClass: AuthGuard },
    ] }).compile();
    const app = module.createNestApplication(); app.use(cookieParser()); await app.init();
    try {
      const body = { firstName: 'HTTP', lastName: 'Child', birthDate: '2018-02-28', guardian: other, loginEnabled: true, role: 'super-admin' };
      const created = await request(app.getHttpServer()).post('/dependents').set('Cookie', `jwt=${parent}`).send(body).expect(201);
      const id = String(created.body._id); expect(created.body.guardian).toBe(parent); expect((await users.findById(id))?.role).toBe('user');
      await request(app.getHttpServer()).put(`/dependents/${id}`).set('Cookie', `jwt=${other}`).send(body).expect(403);
      await request(app.getHttpServer()).post('/dependents').set('Cookie', `jwt=${parent}`).send({ ...body, birthDate: '2025-02-29' }).expect(400);
      await request(app.getHttpServer()).get('/dependents').set('Cookie', `jwt=${id}`).expect(401);
      await request(app.getHttpServer()).put(`/dependents/${id}/guardian`).set('Cookie', `jwt=${other}`).send({ guardian: other, confirmExistingPatient: true }).expect(403);
      await request(app.getHttpServer()).delete(`/dependents/${id}/guardian`).set('Cookie', `jwt=${parent}`).expect(200);
      const after = await request(app.getHttpServer()).get('/dependents').set('Cookie', `jwt=${parent}`).expect(200); expect(after.body).toEqual([]);
    } finally { await app.close(); }
  });
  it('requires verified parents and explicit scoped staff confirmation for existing patient links', async () => {
    await users.updateOne({ _id: parent }, { $unset: { otpVerifiedAt: 1 } });
    await expect(child()).rejects.toThrow();
    await users.updateOne({ _id: parent }, { $set: { otpVerifiedAt: new Date() } });
    const existing = await users.create({ firstName: 'Existing', role: 'user', status: 'walk_in', clinics: [clinic] });
    await expect(dependents.link({ sub: other, role: 'user' }, existing.id, { guardian: parent, confirmExistingPatient: true })).rejects.toThrow();
    await expect(dependents.link({ sub: other, role: 'admin', clinics: [] }, existing.id, { guardian: parent, confirmExistingPatient: true })).rejects.toThrow();
    await expect(dependents.link({ sub: other, role: 'super-admin' }, existing.id, { guardian: parent, confirmExistingPatient: false })).rejects.toThrow();
    await dependents.link({ sub: other, role: 'admin', clinics: [clinic] }, existing.id, { guardian: parent, confirmExistingPatient: true });
    expect((await dependents.list(await actor())).map(row => String(row._id))).toContain(existing.id);
    await expect(dependents.unlink({ sub: other, role: 'admin', clinics: [clinic] }, existing.id, other)).rejects.toThrow();
    expect(String((await users.findById(existing.id))?.guardian)).toBe(parent);
    const outside = await clinics.create({ name: 'Outside clinic' });
    await users.updateOne({ _id: existing._id }, { $set: { clinics: [clinic, outside._id] } });
    await expect(dependents.unlink({ sub: other, role: 'admin', clinics: [clinic] }, existing.id, parent)).rejects.toThrow();
  });
});
