import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Connection, createConnection, Model } from 'mongoose';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OtpService } from '../otp/otp.service';
import { MailerService } from '../mailer/mailer.service';
import { UsersService } from '../users/users.service';
import { UsersController } from '../users/users.controller';
import { ProfilePictureGuard } from '../users/profile-picture.guard';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentsController } from '../appointments/appointments.controller';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsController } from '../analytics/analytics.controller';
import { ClinicsController } from '../clinics/clinics.controller';
import { ClinicsService } from '../clinics/clinics.service';
import { ReferralsController } from '../referral/referrals.controller';
import { ReferralsService } from '../referral/referrals.service';

const uri = process.env.TEST_ADMIN_SCOPE_MONGO_URI;
const isolated = uri ? describe : describe.skip;

// Removing the clinic boundary must expose B records and fail these assertions.
isolated('Admin clinic access through the authenticated API', () => {
  let connection: Connection;
  let app: INestApplication;
  let users: Model<User>;
  let appointments: Model<Appointment>;
  let clinics: Model<Clinic>;
  let referrals: Model<Referral>;
  let catalog: Model<DentalCatalog>;
  let fixture: {
    admin: string; otherAdmin: string; superAdmin: string;
    sharedDentist: string; outsideDentist: string;
    patient: string; outsidePatient: string;
    clinicA: string; clinicB: string;
    appointmentA: string; appointmentB: string;
  };
  const today = new Date('2026-10-02');

  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_admin_scope_test?replicaSet=clinica-test')
      throw new Error('Use only the isolated admin scope test database.');
    connection = await createConnection(uri).asPromise();
    users = connection.model(User.name, UserSchema);
    clinics = connection.model(Clinic.name, ClinicSchema);
    appointments = connection.model(Appointment.name, AppointmentSchema);
    referrals = connection.model(Referral.name, ReferralSchema);
    catalog = connection.model(DentalCatalog.name, DentalCatalogSchema);
    const userService = new UsersService(users, clinics, appointments);
    const appointmentService = new AppointmentsService(
      appointments,
      new AppointmentSchedulingService(appointments, users, clinics, catalog),
      referrals, users,
    );
    const tokenActor = (token: string) => {
      if (token === 'admin') return { sub: fixture.admin, role: 'admin', clinics: [fixture.clinicB] };
      if (token === 'super') return { sub: fixture.superAdmin, role: 'super-admin' };
      if (token === 'dentist') return { sub: fixture.sharedDentist, role: 'dentist' };
      if (token === 'patient') return { sub: fixture.patient, role: 'user' };
      throw new Error('Invalid test token');
    };
    const auth = new AuthService(
      { verifyAsync: async (token: string) => tokenActor(token) } as unknown as JwtService,
      userService, {} as OtpService, {} as MailerService,
    );
    const module = await Test.createTestingModule({
      controllers: [UsersController, AppointmentsController, AnalyticsController, ClinicsController, ReferralsController],
      providers: [
        ProfilePictureGuard,
        { provide: ClinicsService, useValue: new ClinicsService(clinics, users) },
        { provide: ReferralsService, useValue: new ReferralsService(referrals, appointments, appointmentService) },
        { provide: UsersService, useValue: userService },
        { provide: AppointmentsService, useValue: appointmentService },
        { provide: AnalyticsService, useValue: new AnalyticsService(appointments, referrals) },
        { provide: AuthService, useValue: auth },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-02T05:00:00Z').getTime());
    await Promise.all([users.deleteMany({}), appointments.deleteMany({}), clinics.deleteMany({}), referrals.deleteMany({}), catalog.deleteMany({})]);
    const places = await clinics.create([{ name: 'Assigned Clinic A' }, { name: 'Outside Clinic B' }]);
    const people = await users.create([
      { username: 'admin-a', role: 'admin', clinics: [places[0]._id] },
      { username: 'admin-b', role: 'admin', clinics: [places[1]._id] },
      { username: 'super', role: 'super-admin' },
      { username: 'doctor-ab', emailAddress: 'learning@example.test', mobileNumber: '+639171112101', role: 'dentist', clinics: places.map(place => place._id), status: 'confirmed' },
      { username: 'doctor-b', role: 'dentist', clinics: [places[1]._id], status: 'confirmed' },
      { username: 'patient-ab', role: 'user', status: 'confirmed', firstName: 'Visible', emailAddress: 'visible@example.test' },
      { username: 'patient-b', role: 'user', status: 'confirmed', firstName: 'Outside', emailAddress: 'outside@example.test' },
    ]);
    const records = await appointments.create([
      { clinic: places[0]._id, dentist: people[3]._id, patient: people[5]._id, date: today, startTime: '09:00', endTime: '10:00', status: 'confirmed', notes: { clinicNotes: 'Assigned notes' } },
      { clinic: places[1]._id, dentist: people[3]._id, patient: people[5]._id, date: today, startTime: '11:00', endTime: '12:00', status: 'confirmed', notes: { clinicNotes: 'Outside notes' } },
      { clinic: places[1]._id, dentist: people[4]._id, patient: people[6]._id, date: today, startTime: '13:00', endTime: '14:00', status: 'confirmed' },
    ]);
    fixture = {
      admin: people[0].id, otherAdmin: people[1].id, superAdmin: people[2].id,
      sharedDentist: people[3].id, outsideDentist: people[4].id,
      patient: people[5].id, outsidePatient: people[6].id,
      clinicA: places[0].id, clinicB: places[1].id,
      appointmentA: records[0].id, appointmentB: records[1].id,
    };
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); await connection?.close(); });

  const get = (path: string, token = 'admin') => request(app.getHttpServer()).get(path).set('Cookie', `jwt=${token}`);

  it('limits appointments by clinic even when the same dentist works at both clinics', async () => {
    const response = await get('/appointments').expect(200);
    expect(response.body.map((row: { _id: string }) => row._id)).toEqual([fixture.appointmentA]);
  });

  it('intersects patient and dentist history filters with assigned clinics', async () => {
    for (const path of [`/appointments?patient=${fixture.patient}`, `/appointments/by-dentist/${fixture.sharedDentist}`]) {
      const response = await get(path).expect(200);
      expect(response.body.map((row: { _id: string }) => row._id)).toEqual([fixture.appointmentA]);
    }
  });

  it('denies direct outside appointment reads and clinical note writes', async () => {
    await get(`/appointments/${fixture.appointmentB}`).expect(403);
    await request(app.getHttpServer()).patch(`/appointments/${fixture.appointmentB}/notes`).set('Cookie', 'jwt=admin').send({ clinicNotes: 'Forged notes' }).expect(403);
    expect((await appointments.findById(fixture.appointmentB))?.notes.clinicNotes).toBe('Outside notes');
  });

  it('limits all-clinic summary, trend, and queue to assigned appointments', async () => {
    const summary = await get('/analytics/summary/all').expect(200);
    expect(summary.body.totalAppointments).toBe(1);
    const trend = await get('/analytics/trend/all').expect(200);
    expect(trend.body.appointments).toEqual([0, 0, 0, 0, 1, 0, 0]);
    const queue = await get('/analytics/queue/all').expect(200);
    expect(queue.body.map((row: { appointmentId: string }) => row.appointmentId)).toEqual([fixture.appointmentA]);
  });

  it.each(['summary', 'trend', 'queue'])('denies a forged outside clinic %s report', async endpoint => {
    await get(`/analytics/${endpoint}/${fixture.clinicB}`).expect(403);
  });

  it('limits users to self, overlapping staff, and patients in assigned clinics', async () => {
    const response = await get('/users').expect(200);
    expect(response.body.map((row: { _id: string }) => row._id).sort()).toEqual([fixture.admin, fixture.sharedDentist, fixture.patient].sort());
  });

  it('denies outside profiles and excludes outside patients from booking choices', async () => {
    await get(`/users/${fixture.outsidePatient}`).expect(403);
    const response = await get('/users/patients').expect(200);
    expect(response.body.map((row: { _id: string }) => row._id)).toEqual([fixture.patient]);
  });

  it('uses current persisted assignment instead of stale token clinics and revokes access on the next request', async () => {
    await users.updateOne({ _id: fixture.admin }, { $set: { clinics: [], clinic: fixture.clinicA } });
    expect((await get('/appointments').expect(200)).body).toEqual([]);
    expect((await get('/analytics/summary/all').expect(200)).body.totalAppointments).toBe(0);
    await get(`/appointments/${fixture.appointmentA}`).expect(403);
    const response = await get('/users').expect(200);
    expect(response.body.map((row: { _id: string }) => row._id)).toEqual([fixture.admin]);
  });

  it('retains legacy absent-array assignments without treating explicit revocation as legacy', async () => {
    await users.updateOne({ _id: fixture.admin }, { $unset: { clinics: 1 }, $set: { clinic: fixture.clinicA } });
    const response = await get('/appointments').expect(200);
    expect(response.body.map((row: { _id: string }) => row._id)).toEqual([fixture.appointmentA]);
  });

  it('preserves super-admin global and patient ownership access', async () => {
    expect((await get('/appointments', 'super').expect(200)).body).toHaveLength(3);
    expect((await get('/analytics/summary/all', 'super').expect(200)).body.totalAppointments).toBe(3);
    expect((await get('/appointments', 'patient').expect(200)).body).toHaveLength(2);
    await get('/users', 'patient').expect(403);
  });

  const profile = (role = 'dentist', extra: Record<string, unknown> = {}) => ({
    firstName: 'Learning', lastName: 'Doctor', username: 'doctor-ab',
    emailAddress: 'learning@example.test', mobileNumber: '+639171112101',
    address: 'Fictional test address', role, ...extra,
  });

  it('does not expose invisible clinic memberships through a shared dentist profile', async () => {
    const response = await get(`/users/${fixture.sharedDentist}`).expect(200);
    expect(response.body.clinics.map((clinic: { _id: string }) => clinic._id)).toEqual([fixture.clinicA]);
  });

  it('preserves outside memberships when an admin edits their part of a shared dentist assignment', async () => {
    await request(app.getHttpServer()).put(`/users/${fixture.sharedDentist}`).set('Cookie', 'jwt=admin')
      .send(profile('dentist', { clinics: [fixture.clinicA] })).expect(200);
    expect((await users.findById(fixture.sharedDentist))?.clinics?.map(clinic => clinic.toString()).sort())
      .toEqual([fixture.clinicA, fixture.clinicB].sort());
  });

  it('rejects outside profile writes and dentist approval before data changes', async () => {
    await request(app.getHttpServer()).put(`/users/${fixture.outsidePatient}`).set('Cookie', 'jwt=admin')
      .send(profile('user', { username: 'forged-outside' })).expect(403);
    await users.updateOne({ _id: fixture.outsideDentist }, { $set: { status: 'pending' } });
    await request(app.getHttpServer()).patch(`/users/${fixture.outsideDentist}/approve-dentist`)
      .set('Cookie', 'jwt=admin').expect(403);
    expect((await users.findById(fixture.outsideDentist))?.status).toBe('pending');
    expect((await users.findById(fixture.outsidePatient))?.username).toBe('patient-b');
  });

  it('denies out-of-scope pictures even when the dentist is approved', async () => {
    await get(`/users/${fixture.outsideDentist}/picture`).expect(403);
  });

  it('associates an admin-created patient with assigned clinics without making a booking', async () => {
    const response = await request(app.getHttpServer()).post('/users').set('Cookie', 'jwt=admin')
      .send(profile('user', { username: 'new-patient', emailAddress: 'new-patient@example.test', mobileNumber: '+639171112108', clinics: [] })).expect(202);
    const directory = await get('/users/patients').expect(200);
    expect(directory.body.map((patient: { _id: string }) => patient._id).sort()).toEqual([fixture.patient, response.body._id].sort());
    expect(await appointments.countDocuments()).toBe(3);
  });
  it('limits accessible clinic choices and denies outside clinic details and filters', async () => {
    expect((await get('/clinics/accessible').expect(200)).body.map((clinic: { _id: string }) => clinic._id)).toEqual([fixture.clinicA]);
    expect((await get('/clinics/accessible', 'super').expect(200)).body).toHaveLength(2);
    await get(`/clinics/${fixture.clinicB}`).expect(403);
    await get(`/appointments?clinic=${fixture.clinicB}`).expect(403);
    const clinic = await get(`/clinics/${fixture.clinicA}`).expect(200);
    expect(clinic.body.dentists[0].clinics.map((value: { _id: string }) => value._id)).toEqual([fixture.clinicA]);
  });

  it('hides outside memberships in populated appointment people', async () => {
    const appointment = await get(`/appointments/${fixture.appointmentA}`).expect(200);
    expect(appointment.body.dentist.clinics).toEqual([fixture.clinicA]);
  });

  it('keeps shared dentist busy times without leaking outside appointment IDs', async () => {
    const slots = await get(`/appointments/availability/${fixture.sharedDentist}`).expect(200);
    expect(slots.body.sort((left: { startTime: string }, right: { startTime: string }) => left.startTime.localeCompare(right.startTime))).toEqual([
      { _id: fixture.appointmentA, date: today.toISOString(), startTime: '09:00', endTime: '10:00', status: 'confirmed' },
      { date: today.toISOString(), startTime: '11:00', endTime: '12:00', status: 'confirmed' },
    ]);
    await get(`/appointments/availability/${fixture.outsideDentist}`).expect(403);
  });

  const booking = (extra: Record<string, unknown> = {}) => ({ clinic: fixture.clinicA, dentist: fixture.sharedDentist,
    patient: fixture.patient, date: '2026-10-05', startTime: '09:00', endTime: '10:00', services: [], ...extra });

  it('denies moving an assigned appointment outside scope or booking an unrelated patient', async () => {
    await appointments.updateOne({ _id: fixture.appointmentA }, { $set: { status: 'pending' } });
    await request(app.getHttpServer()).put(`/appointments/${fixture.appointmentA}`).set('Cookie', 'jwt=admin')
      .send(booking({ clinic: fixture.clinicB })).expect(403);
    await request(app.getHttpServer()).post('/appointments').set('Cookie', 'jwt=admin')
      .send(booking({ patient: fixture.outsidePatient })).expect(403);
    expect((await appointments.findById(fixture.appointmentA))?.clinic.toString()).toBe(fixture.clinicA);
    expect(await appointments.countDocuments()).toBe(3);
  });

  it('limits referrals by source or receiving clinic and hides outside receiving details', async () => {
    const [own, outside, received] = await referrals.create([
      { fromDoctorId: fixture.sharedDentist, fromClinicId: fixture.clinicA, patient: fixture.patient, reason: 'Assigned handoff', status: 'pending' },
      { fromDoctorId: fixture.outsideDentist, fromClinicId: fixture.clinicB, patient: fixture.outsidePatient, reason: 'Outside handoff', status: 'pending' },
      { fromDoctorId: fixture.outsideDentist, fromClinicId: fixture.clinicB, patient: fixture.patient, reason: 'Received handoff', status: 'pending' },
    ]);
    await appointments.updateOne({ _id: fixture.appointmentB }, { $set: { referral: own._id } });
    await appointments.updateOne({ _id: fixture.appointmentA }, { $set: { referral: received._id } });
    const list = await get('/referrals').expect(200);
    expect(list.body.map((referral: { _id: string }) => referral._id).sort()).toEqual([own.id, received.id].sort());
    expect((await get(`/referrals/${own.id}`).expect(200)).body.appointment).toBeNull();
    expect((await get(`/referrals/${received.id}`).expect(200)).body.appointment._id).toBe(fixture.appointmentA);
    await get(`/referrals/${outside.id}`).expect(403);
    await request(app.getHttpServer()).patch(`/referrals/${own.id}/reject`).set('Cookie', 'jwt=admin').send({ reasonOfDecline: 'Outside change' }).expect(403);
    expect((await appointments.findById(fixture.appointmentB))?.status).toBe('confirmed');
  });

  it('denies creating a referral from an outside clinic', async () => {
    await request(app.getHttpServer()).post('/referrals').set('Cookie', 'jwt=admin')
      .send({ fromDoctorId: fixture.sharedDentist, fromClinicId: fixture.clinicB, patient: fixture.patient, reason: 'Forged source' }).expect(403);
    expect(await referrals.countDocuments()).toBe(0);
  });

  it('does not allow deleting a shared dentist that belongs to another clinic', async () => {
    await request(app.getHttpServer()).delete(`/users/${fixture.sharedDentist}`).set('Cookie', 'jwt=admin').expect(403);
    expect(await users.exists({ _id: fixture.sharedDentist })).toBeTruthy();
  });

  it('does not expose outside memberships after a shared dentist picture update', async () => {
    const actor = { sub: fixture.admin, role: 'admin', clinics: [fixture.clinicA] };
    const updated = await app.get(UsersService).updateProfilePicture(fixture.sharedDentist, 'scope-test.png', actor);
    expect(JSON.parse(JSON.stringify(updated)).clinics).toEqual([fixture.clinicA]);
  });

  it('keeps existing appointments readable when the populated dentist no longer exists', async () => {
    await users.deleteOne({ _id: fixture.sharedDentist });
    const response = await get('/appointments').expect(200);
    expect(response.body[0]._id).toBe(fixture.appointmentA);
    expect(response.body[0].dentist).toBeNull();
  });

  it.each([
    { password: 'ScopeChanged1!' }, { username: 'takeover' },
    { emailAddress: 'takeover@example.test' }, { mobileNumber: '+639171112109' },
  ])('denies changing another shared account’s sign-in or verification fields: %j', async changes => {
    await request(app.getHttpServer()).put(`/users/${fixture.sharedDentist}`).set('Cookie', 'jwt=admin')
      .send(profile('dentist', { clinics: [fixture.clinicA], ...changes })).expect(403);
    expect((await users.findById(fixture.sharedDentist))?.username).toBe('doctor-ab');
  });

  it('rejects role-less user creation instead of accepting forged outside memberships', async () => {
    const body: Record<string, unknown> = profile('user', { username: 'roleless', emailAddress: 'roleless@example.test', mobileNumber: '+639171112107', clinics: [fixture.clinicB] });
    delete body.role;
    await request(app.getHttpServer()).post('/users').set('Cookie', 'jwt=admin').send(body).expect(400);
    expect(await users.exists({ username: 'roleless' })).toBeNull();
  });

  it('uses a promoted dentist’s current admin scope even while the old dentist token remains valid', async () => {
    await users.updateOne({ _id: fixture.sharedDentist }, { $set: { role: 'admin', clinics: [fixture.clinicA] } });
    const response = await get('/appointments', 'dentist').expect(200);
    expect(response.body.map((row: { _id: string }) => row._id)).toEqual([fixture.appointmentA]);
    await get(`/appointments/${fixture.appointmentB}`, 'dentist').expect(403);
  });

  it('does not let an admin reactivate outside historical ownership by changing their own role', async () => {
    await appointments.updateOne({ _id: fixture.appointmentB }, { $set: { dentist: fixture.admin } });
    await request(app.getHttpServer()).put(`/users/${fixture.admin}`).set('Cookie', 'jwt=admin')
      .send(profile('dentist', { username: 'admin-a', emailAddress: 'admin-a@example.test', mobileNumber: '+639171112105', clinics: [fixture.clinicA] })).expect(403);
    expect((await users.findById(fixture.admin))?.role).toBe('admin');
  });

});
