import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Connection, createConnection, Model } from 'mongoose';
import * as request from 'supertest';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { assignedClinicIds } from '../users/clinic-membership';
import { CareAccessService } from './care-access.service';
import { PatientRecordsController } from './patient-records.controller';
import { PatientRecordsService } from './patient-records.service';

const uri = process.env.TEST_CARE_MONGO_URI;
(uri ? describe : describe.skip)('Patient record search HTTP and database scope', () => {
  let connection: Connection;
  let app: INestApplication;
  let users: Model<User>;
  let appointments: Model<Appointment>;
  let fixture: { clinic: string; outside: string; admin: string; noClinic: string; superAdmin: string; dentist: string; patient: string; outsidePatient: string; literal: string };
  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_care_spec?replicaSet=clinica-test') throw new Error('Use only the care task isolated database.');
    connection = await createConnection(uri).asPromise();
    users = connection.model(User.name, UserSchema);
    appointments = connection.model(Appointment.name, AppointmentSchema);
    connection.model(Clinic.name, ClinicSchema);
    connection.model(DentalCatalog.name, DentalCatalogSchema);
    const access = new CareAccessService(users, appointments);
    const guard: CanActivate = { canActivate: async (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
      const identity = req.headers['x-fixture-user'];
      const person = identity && await users.findById(identity).lean();
      if (!person) throw new UnauthorizedException();
      req.user = { sub: person._id.toString(), role: person.role, clinics: assignedClinicIds(person) };
      return true;
    } };
    const module = await Test.createTestingModule({ controllers: [PatientRecordsController], providers: [
      { provide: PatientRecordsService, useValue: new PatientRecordsService(access, users, appointments) },
      { provide: APP_GUARD, useValue: guard },
    ] }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(async () => {
    await Promise.all(Object.values(connection.models).map(model => model.deleteMany({})));
    const places = await connection.model<Clinic>(Clinic.name).create([{ name: 'Care clinic' }, { name: 'Outside clinic' }]);
    const people = await users.create([
      { role: 'admin', username: 'admin', clinics: [places[0]._id] },
      { role: 'admin', username: 'empty', clinics: [] },
      { role: 'super-admin', username: 'global' },
      { role: 'dentist', username: 'dentist', clinics: places.map(place => place._id) },
      { role: 'user', username: 'ana.patient', firstName: 'Ana', lastName: 'Rivera', mobileNumber: '+639171230001', emailAddress: 'ana@example.test', clinics: [places[0]._id], password: 'secret-fixture-hash', resetOtp: 'secret-fixture-otp', status: 'confirmed' },
      { role: 'user', username: 'outside.patient', firstName: 'Outside', lastName: 'Patient', clinics: [places[1]._id] },
      { role: 'user', username: 'literal.patient', firstName: 'Ana.*(test)', lastName: 'Literal', clinics: [places[0]._id], status: 'walk_in', isWalkIn: true },
    ]);
    fixture = { clinic: places[0].id, outside: places[1].id, admin: people[0].id, noClinic: people[1].id, superAdmin: people[2].id, dentist: people[3].id, patient: people[4].id, outsidePatient: people[5].id, literal: people[6].id };
    await appointments.create([
      { patient: people[4]._id, dentist: people[3]._id, clinic: places[0]._id, date: '2026-10-03', startTime: '09:00', endTime: '09:30', status: 'confirmed' },
      { patient: people[4]._id, dentist: people[3]._id, clinic: places[1]._id, date: '2026-10-04', startTime: '09:00', endTime: '09:30', status: 'confirmed' },
      { patient: people[5]._id, dentist: people[3]._id, clinic: places[1]._id, date: '2026-10-05', startTime: '09:00', endTime: '09:30', status: 'confirmed' },
    ]);
  });
  afterAll(async () => { await app?.close(); await connection?.close(); });
  const get = (url: string, actor?: string) => {
    const req = request(app.getHttpServer()).get(url);
    return actor ? req.set('x-fixture-user', actor) : req;
  };
  it('requires authentication and rejects patients from staff records', async () => {
    await get('/care/patients').expect(401);
    await get('/care/patients', fixture.patient).expect(403);
    await get(`/care/patients/${fixture.patient}`, fixture.patient).expect(403);
  });
  it('searches by full name, contact and exact record ID', async () => {
    for (const search of ['Ana Rivera', '+639171230001', 'ana@example.test', fixture.patient]) {
      const result = await get(`/care/patients?search=${encodeURIComponent(search)}`, fixture.admin).expect(200);
      expect(result.body.items.map((item: { _id: string }) => item._id)).toEqual([fixture.patient]);
    }
  });
  it('keeps regex input literal and allows identified contactless walk-ins', async () => {
    const result = await get('/care/patients?search=Ana.*(test)', fixture.admin).expect(200);
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toMatchObject({ _id: fixture.literal, status: 'walk_in', isWalkIn: true });
  });
  it('does not expose private credential fields', async () => {
    const result = await get('/care/patients', fixture.superAdmin).expect(200);
    expect(JSON.stringify(result.body)).not.toMatch(/secret-fixture|password|resetOtp|otpVerifiedAt|clinics/);
  });
  it('limits admin search and detail despite a shared dentist and patient', async () => {
    const result = await get('/care/patients', fixture.admin).expect(200);
    expect(result.body.total).toBe(2);
    const detail = await get(`/care/patients/${fixture.patient}`, fixture.admin).expect(200);
    expect(detail.body.appointments).toHaveLength(1);
    expect(detail.body.appointments[0].clinic._id).toBe(fixture.clinic);
    await get(`/care/patients/${fixture.outsidePatient}`, fixture.admin).expect(403);
    await get(`/care/patients?clinic=${fixture.outside}`, fixture.admin).expect(403);
  });
  it('resolves current membership and gives unassigned admins empty search', async () => {
    expect((await get('/care/patients', fixture.noClinic).expect(200)).body.total).toBe(0);
    await users.updateOne({ _id: fixture.admin }, { $set: { clinics: [] } });
    expect((await get('/care/patients', fixture.admin).expect(200)).body.total).toBe(0);
    await get(`/care/patients/${fixture.patient}`, fixture.admin).expect(403);
  });
  it('restricts dentist discovery to their established patients', async () => {
    const result = await get('/care/patients', fixture.dentist).expect(200);
    expect(result.body.items.map((item: { _id: string }) => item._id).sort()).toEqual([fixture.patient, fixture.outsidePatient].sort());
    await get(`/care/patients/${fixture.literal}`, fixture.dentist).expect(403);
  });
  it('validates malformed IDs, page limits and search length at HTTP boundary', async () => {
    for (const query of ['clinic=bad', 'page=0', 'page=1.5', 'page=100001', `search=${'a'.repeat(101)}`]) await get(`/care/patients?${query}`, fixture.admin).expect(400);
    await get('/care/patients/bad', fixture.admin).expect(400);
    const page = await get('/care/patients?page=2', fixture.superAdmin).expect(200);
    expect(page.body).toMatchObject({ items: [], page: 2, pageSize: 20, total: 3 });
  });
});
