import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Connection, createConnection, Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentsController } from '../appointments/appointments.controller';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { UsersController } from '../users/users.controller';
import { Otp, OtpSchema } from '../otp/entities/otp.entity';
import { OtpService } from '../otp/otp.service';
import { MailerService } from '../mailer/mailer.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';

const uri = process.env.TEST_WALK_IN_MONGO_URI;
const isolated = uri ? describe : describe.skip;
isolated('Walk-in registration and verified booking contract', () => {
  let connection: Connection;
  let app: INestApplication;
  let users: Model<User>;
  let appointments: Model<Appointment>;
  let otps: Model<Otp>;
  let fixture: { admin: string; outsideAdmin: string; patient: string; dentist: string; clinic: string; outsideClinic: string; service: string };
  const claims = new Map<string, Record<string, unknown>>();
  let code = '';
  let recipient = '';
  const password = 'WalkIn123!';

  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_walk_in_spec?replicaSet=clinica-test') throw new Error('Use only this task’s isolated database.');
    connection = await createConnection(uri).asPromise();
    users = connection.model(User.name, UserSchema);
    appointments = connection.model(Appointment.name, AppointmentSchema);
    const clinics = connection.model(Clinic.name, ClinicSchema);
    const catalog = connection.model(DentalCatalog.name, DentalCatalogSchema);
    const referrals = connection.model(Referral.name, ReferralSchema);
    otps = connection.model(Otp.name, OtpSchema);
    const userService = new UsersService(users, clinics, appointments);
    const jwt = {
      verifyAsync: async (token: string) => { const payload = claims.get(token); if (!payload) throw new Error('Unknown fixture token'); return payload; },
      signAsync: async (payload: Record<string, unknown>) => { const token = `fixture-${claims.size}`; claims.set(token, payload); return token; },
    } as unknown as JwtService;
    const auth = new AuthService(jwt, userService, new OtpService(otps), {
      sendOtp: async (email: string, value: string) => { recipient = email; code = value; },
    } as MailerService);
    const service = new AppointmentsService(appointments, new AppointmentSchedulingService(appointments, users, clinics, catalog), referrals, users);
    const module = await Test.createTestingModule({ controllers: [UsersController, AuthController, AppointmentsController], providers: [
      { provide: UsersService, useValue: userService }, { provide: AuthService, useValue: auth },
      { provide: AppointmentsService, useValue: service }, { provide: APP_GUARD, useClass: AuthGuard },
    ] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });
  beforeEach(async () => {
    await Promise.all(Object.values(connection.models).map(model => model.deleteMany({})));
    code = ''; recipient = ''; claims.clear();
    const hours = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day => ({ day, startTime: '08:00', endTime: '18:00' }));
    const clinics = connection.model<Clinic>(Clinic.name);
    const places = await clinics.create([{ name: 'Walk-in clinic', operatingHours: hours }, { name: 'Outside clinic', operatingHours: hours }]);
    const people = await users.create([
      { role: 'admin', username: 'admin', clinics: [places[0]._id], status: 'confirmed' },
      { role: 'admin', username: 'outside', clinics: [places[1]._id], status: 'confirmed' },
      { role: 'user', username: 'patient', firstName: 'Local', lastName: 'Patient', emailAddress: 'patient@example.test', mobileNumber: '+639171110001', password: await bcrypt.hash(password, 4), clinics: [places[0]._id], status: 'confirmed' },
      { role: 'dentist', username: 'dentist', clinics: [places[0]._id], operatingHours: hours, status: 'confirmed' },
    ]);
    const service = await connection.model<DentalCatalog>(DentalCatalog.name).create({ name: 'Consultation', duration: 30 });
    fixture = { admin: people[0].id, outsideAdmin: people[1].id, patient: people[2].id, dentist: people[3].id, clinic: places[0].id, outsideClinic: places[1].id, service: service.id };
    for (const [token, person] of [['admin', people[0]], ['outside', people[1]], ['patient', people[2]], ['dentist', people[3]]] as const) claims.set(token, { sub: person.id, role: person.role, username: person.username });
  });
  afterAll(async () => { await app?.close(); await connection?.close(); });
  const staffPost = (path: string, body: object, token = 'admin') => request(app.getHttpServer()).post(path).set('Cookie', `jwt=${token}`).send(body);
  const profile = (username = 'new.walkin') => ({ firstName: 'Learning', lastName: 'Walkin', username, password, address: 'Manila', role: 'user', isWalkIn: true });
  const booking = (patient = fixture.patient) => ({ clinic: fixture.clinic, patient, dentist: fixture.dentist, services: [fixture.service], date: '2026-10-12', startTime: '09:00', endTime: '09:30' });
  const setPatient = (status: string, extra: Record<string, unknown> = {}) => users.updateOne({ _id: fixture.patient }, { $set: { status, ...extra } });
  const signin = () => staffPost('/auth/sign-in', { username: 'patient', password });
  const cookie = (response: request.Response) => response.headers['set-cookie'][0].split(';')[0];

  it('creates a contactless admin walk-in account with clinic ownership and staff-bookable status', async () => {
    const response = await staffPost('/users', profile()).expect(202);
    expect(response.body).toMatchObject({ role: 'user', status: 'walk_in', isWalkIn: true, clinics: [{ _id: fixture.clinic }] });
    await staffPost('/appointments', { ...booking(response.body._id), isWalkIn: true }).expect(201);
  });
  it('allows multiple contactless accounts and edits without false duplicate-contact conflicts', async () => {
    const first = await staffPost('/users', profile('first.walkin')).expect(202);
    await staffPost('/users', profile('second.walkin')).expect(202);
    await request(app.getHttpServer()).put(`/users/${first.body._id}`).set('Cookie', 'jwt=admin').send({ ...profile('first.walkin'), firstName: 'Updated', password: undefined }).expect(200);
  });
  it('keeps contacts required for ordinary accounts and validates supplied walk-in contacts', async () => {
    await staffPost('/users', { ...profile(), isWalkIn: false }).expect(400);
    await staffPost('/users', { ...profile(), emailAddress: 'invalid' }).expect(400);
    await staffPost('/users', { ...profile(), mobileNumber: 'invalid' }).expect(400);
  });
  it('rejects public walk-in registration and walk-in privileges for staff roles', async () => {
    await request(app.getHttpServer()).post('/users/register').send(profile()).expect(403);
    await staffPost('/users', { ...profile(), role: 'admin' }).expect(400);
  });
  it.each(['pending', 'rejected'])('blocks staff booking a %s patient in the API as the selector does', async status => {
    await setPatient(status);
    await staffPost('/appointments', booking()).expect(400);
    expect(await appointments.countDocuments()).toBe(0);
  });
  it('allows staff booking a walk-in while keeping appointment confirmation separate', async () => {
    await setPatient('walk_in', { isWalkIn: true });
    const result = await staffPost('/appointments', { ...booking(), isWalkIn: true }).expect(201);
    expect(result.body).toMatchObject({ status: 'pending', isWalkIn: true });
  });
  it.each(['walk_in', 'pending', 'rejected'])('blocks self booking from a %s patient even with an old full session', async status => {
    await setPatient(status);
    await staffPost('/appointments', booking(), 'patient').expect(403);
  });
  it('preserves clinic isolation and rejects self-service walk-in visit flags', async () => {
    await staffPost('/appointments', booking(), 'outside').expect(403);
    await staffPost('/appointments', { ...booking(), isWalkIn: true }, 'patient').expect(403);
  });
  it('defaults visits to non-walk-in and preserves the flag during rescheduling', async () => {
    const normal = await staffPost('/appointments', booking()).expect(201);
    expect(normal.body.isWalkIn).toBe(false);
    const visit = await staffPost('/appointments', { ...booking(), startTime: '10:00', endTime: '10:30', isWalkIn: true }).expect(201);
    await request(app.getHttpServer()).patch(`/appointments/${visit.body._id}/reschedule`).set('Cookie', 'jwt=admin').send({ date: '2026-10-13', startTime: '10:00', endTime: '10:30', reason: 'Learning fixture' }).expect(200);
    expect((await appointments.findById(visit.body._id))?.toJSON()).toMatchObject({ isWalkIn: true });
  });
  it.each(['pending','walk_in'])('requires OTP and promotes a %s patient after successful normal verification', async status => {
    await setPatient(status, { isWalkIn: status === 'walk_in', otpVerifiedAt: new Date() });
    const login = await signin().expect(200);
    expect(login.body.otpRequired).toBe(true);
    expect(recipient).toBe('patient@example.test');
    const verified = await request(app.getHttpServer()).post('/auth/verify-otp').set('Cookie', cookie(login)).send({ code }).expect(200);
    expect(verified.body.user).toMatchObject({ status: 'confirmed', isWalkIn: status === 'walk_in' });
    expect(verified.body.user.clinics[0]._id).toBe(fixture.clinic);
    await request(app.getHttpServer()).post('/appointments').set('Cookie', cookie(verified)).send(booking()).expect(201);
  });
  it('leaves a walk-in eligible for staff care when OTP is wrong or expired', async () => {
    await setPatient('walk_in', { isWalkIn: true });
    const login = await signin().expect(200);
    await request(app.getHttpServer()).post('/auth/verify-otp').set('Cookie', cookie(login)).send({ code: '000000' }).expect(400);
    await otps.collection.updateOne({ user: new connection.base.Types.ObjectId(fixture.patient) }, { $set: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    await request(app.getHttpServer()).post('/auth/verify-otp').set('Cookie', cookie(login)).send({ code }).expect(400);
    expect((await users.findById(fixture.patient))?.status).toBe('walk_in');
    await staffPost('/appointments', booking()).expect(201);
  });
  it('requires a clinic-supplied email before contactless walk-in online activation', async () => {
    await setPatient('walk_in', { isWalkIn: true });
    await users.updateOne({ _id: fixture.patient }, { $unset: { emailAddress: 1, mobileNumber: 1 } });
    const blocked = await signin().expect(400);
    expect(blocked.body.message).toContain('clinic');
    await request(app.getHttpServer()).put(`/users/${fixture.patient}`).set('Cookie', 'jwt=admin').send({ ...profile('patient'), emailAddress: 'patient@example.test', password: undefined }).expect(200);
    const login = await signin().expect(200);
    await request(app.getHttpServer()).post('/auth/verify-otp').set('Cookie', cookie(login)).send({ code }).expect(200);
  });
  it('rejects an OTP sent to an old email and invalidates contact verification on an email change', async () => {
    await setPatient('walk_in', { isWalkIn: true });
    const login = await signin().expect(200);
    await request(app.getHttpServer()).put(`/users/${fixture.patient}`).set('Cookie', 'jwt=admin').send({ ...profile('patient'), emailAddress: 'changed@example.test', password: undefined }).expect(200);
    await request(app.getHttpServer()).post('/auth/verify-otp').set('Cookie', cookie(login)).send({ code }).expect(400);
    await setPatient('confirmed', { otpVerifiedAt: new Date() });
    await request(app.getHttpServer()).put(`/users/${fixture.patient}`).set('Cookie', 'jwt=admin').send({ ...profile('patient'), emailAddress: 'again@example.test', password: undefined }).expect(200);
    const stored = await users.findById(fixture.patient);
    expect(stored?.status).toBe('walk_in');
    expect(stored?.otpVerifiedAt).toBeUndefined();
  });
  it('does not permit patients to grant themselves walk-in privileges', async () => {
    await request(app.getHttpServer()).put(`/users/${fixture.patient}`).set('Cookie', 'jwt=patient').send({ ...profile('patient'), emailAddress: 'patient@example.test', mobileNumber: '+639171110001', password: undefined }).expect(403);
    expect((await users.findById(fixture.patient))?.status).toBe('confirmed');
  });

  it('cannot confirm a contactless patient using an unbound legacy OTP', async () => {
    await setPatient('walk_in', { isWalkIn: true });
    await users.updateOne({ _id: fixture.patient }, { $unset: { emailAddress: 1 } });
    await otps.create({ user: fixture.patient, code: await bcrypt.hash('123456', 4) });
    claims.set('legacy-partial', { sub: fixture.patient, otpPending: true });
    await request(app.getHttpServer()).post('/auth/verify-otp').set('Cookie', 'jwt=legacy-partial').send({ code: '123456' }).expect(400);
    expect((await users.findById(fixture.patient))?.status).toBe('walk_in');
  });
});
