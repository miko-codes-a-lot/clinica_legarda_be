import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
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
import { Visit, VisitSchema } from './entities/visit.entity';
import { VisitsService } from './visits.service';
import { VisitsController } from './visits.controller';
import { manilaDay } from './visit-rules';
import { TreatmentCase, TreatmentCaseSchema } from './entities/treatment-case.entity';
import { TreatmentCasesController } from './treatment-cases.controller';
import { TreatmentCasesService } from './treatment-cases.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentsController } from '../appointments/appointments.controller';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { UsersService } from '../users/users.service';
import { UsersController } from '../users/users.controller';

const uri = process.env.TEST_CARE_MONGO_URI;
(uri ? describe : describe.skip)('Patient record search HTTP and database scope', () => {
  let connection: Connection;
  let app: INestApplication;
  let users: Model<User>;
  let appointments: Model<Appointment>;
  let visits: Model<Visit>;
  let cases: Model<TreatmentCase>;
  let fixture: { clinic: string; outside: string; admin: string; noClinic: string; superAdmin: string; dentist: string; patient: string; outsidePatient: string; literal: string; service: string };
  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_care_spec?replicaSet=clinica-test') throw new Error('Use only the care task isolated database.');
    connection = await createConnection(uri).asPromise();
    users = connection.model(User.name, UserSchema);
    appointments = connection.model(Appointment.name, AppointmentSchema);
    visits = connection.model(Visit.name, VisitSchema);
    cases = connection.model(TreatmentCase.name, TreatmentCaseSchema);
    connection.model(Clinic.name, ClinicSchema);
    connection.model(DentalCatalog.name, DentalCatalogSchema);
    connection.model(Referral.name, ReferralSchema);
    const access = new CareAccessService(users, appointments, visits);
    const guard: CanActivate = { canActivate: async (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
      const identity = req.headers['x-fixture-user'];
      const person = identity && await users.findById(identity).lean();
      if (!person) throw new UnauthorizedException();
      req.user = { sub: person._id.toString(), role: person.role, clinics: assignedClinicIds(person) };
      return true;
    } };
    const module = await Test.createTestingModule({ controllers: [PatientRecordsController, VisitsController, TreatmentCasesController, AppointmentsController, UsersController], providers: [
      { provide: PatientRecordsService, useValue: new PatientRecordsService(access, users, appointments) },
      { provide: VisitsService, useValue: new VisitsService(access, visits, users, connection.model<Clinic>(Clinic.name), appointments, cases) },
      { provide: TreatmentCasesService, useValue: new TreatmentCasesService(access, cases, visits, appointments, users, connection.model<Clinic>(Clinic.name)) },
      { provide: UsersService, useValue: new UsersService(users, connection.model<Clinic>(Clinic.name), appointments, visits) },
      { provide: AppointmentsService, useValue: new AppointmentsService(appointments, new AppointmentSchedulingService(appointments, users, connection.model<Clinic>(Clinic.name), connection.model<DentalCatalog>(DentalCatalog.name)), connection.model<Referral>(Referral.name), users, cases, visits) },
      { provide: APP_GUARD, useValue: guard },
    ] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });
  beforeEach(async () => {
    await Promise.all(Object.values(connection.models).map(model => model.deleteMany({})));
    const hours = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => ({ day, startTime: '08:00', endTime: '18:00' }));
    const places = await connection.model<Clinic>(Clinic.name).create([{ name: 'Care clinic', operatingHours: hours }, { name: 'Outside clinic', operatingHours: hours }]);
    const people = await users.create([
      { role: 'admin', username: 'admin', clinics: [places[0]._id] },
      { role: 'admin', username: 'empty', clinics: [] },
      { role: 'super-admin', username: 'global' },
      { role: 'dentist', username: 'dentist', clinics: places.map(place => place._id), status: 'confirmed', operatingHours: hours },
      { role: 'user', username: 'ana.patient', firstName: 'Ana', lastName: 'Rivera', mobileNumber: '+639171230001', emailAddress: 'ana@example.test', clinics: [places[0]._id], password: 'secret-fixture-hash', resetOtp: 'secret-fixture-otp', status: 'confirmed' },
      { role: 'user', username: 'outside.patient', firstName: 'Outside', lastName: 'Patient', clinics: [places[1]._id] },
      { role: 'user', username: 'literal.patient', firstName: 'Ana.*(test)', lastName: 'Literal', clinics: [places[0]._id], status: 'walk_in', isWalkIn: true },
    ]);
    const service = await connection.model<DentalCatalog>(DentalCatalog.name).create({ name: 'Consultation', duration: 30 });
    fixture = { clinic: places[0].id, outside: places[1].id, admin: people[0].id, noClinic: people[1].id, superAdmin: people[2].id, dentist: people[3].id, patient: people[4].id, outsidePatient: people[5].id, literal: people[6].id, service: service.id };
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

  const intake = () => ({ patient: fixture.patient, dentist: fixture.dentist, clinic: fixture.clinic, purpose: 'consultation', isWalkIn: true });
  const postVisit = (body: object, actor = fixture.admin) => request(app.getHttpServer()).post('/care/visits').set('x-fixture-user', actor).send(body);
  const state = (id: string, value: string, actor: string, reason?: string) => request(app.getHttpServer()).patch(`/care/visits/${id}/state`).set('x-fixture-user', actor).send({ state: value, ...(reason ? { reason } : {}) });

  it('checks in an identified walk-in and makes their care visible to the responsible dentist', async () => {
    const result = await postVisit({ ...intake(), patient: fixture.literal }).expect(201);
    expect(result.body).toMatchObject({ state: 'waiting', date: manilaDay(), isWalkIn: true, purpose: 'consultation', patient: { _id: fixture.literal } });
    expect(result.body.activeKey).toBeUndefined();
    const search = await get('/care/patients?search=Literal', fixture.dentist).expect(200);
    expect(search.body.items[0]._id).toBe(fixture.literal);
    const queue = await get('/care/queue', fixture.admin).expect(200);
    expect(queue.body.map((visit: { _id: string }) => visit._id)).toEqual([result.body._id]);
  });
  it('rejects pending intake, another clinic, wrong dentist and anonymous patient payloads', async () => {
    await users.updateOne({ _id: fixture.patient }, { $set: { status: 'pending' } });
    await postVisit(intake()).expect(400);
    await postVisit({ ...intake(), clinic: fixture.outside }).expect(403);
    await postVisit({ ...intake(), patient: undefined }).expect(400);
    await postVisit({ ...intake(), patient: fixture.literal, dentist: fixture.admin }).expect(400);
    await postVisit(intake(), fixture.patient).expect(403);
  });
  it('serializes simultaneous patient check-in and preserves a single active visit', async () => {
    const results = await Promise.all([postVisit(intake()), postVisit(intake())]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await visits.countDocuments()).toBe(1);
  });
  it('starts care only for the responsible clinician and retains cancellation audit', async () => {
    const first = await postVisit(intake()).expect(201);
    await state(first.body._id, 'in_progress', fixture.admin).expect(403);
    await state(first.body._id, 'in_progress', fixture.dentist).expect(200);
    await state(first.body._id, 'cancelled', fixture.admin).expect(400);
    const ended = await state(first.body._id, 'cancelled', fixture.admin, 'Patient had to leave').expect(200);
    expect(ended.body.events).toHaveLength(3);
    expect(ended.body.events[2].reason).toBe('Patient had to leave');
    await state(first.body._id, 'in_progress', fixture.dentist).expect(409);
    await postVisit(intake()).expect(201);
    expect(await visits.countDocuments()).toBe(2);
  });
  it('prevents duplicate active appointment visits and permits a fresh check-in after a cancelled attempt', async () => {
    const appointment = await appointments.create({ patient: fixture.patient, dentist: fixture.dentist, clinic: fixture.clinic, date: manilaDay(), startTime: '10:00', endTime: '10:30', status: 'confirmed' });
    const first = await postVisit({ ...intake(), appointment: appointment.id, isWalkIn: false }).expect(201);
    expect(first.body.appointment).toBe(appointment.id);
    expect(first.body.isWalkIn).toBe(false);
    await postVisit({ ...intake(), appointment: appointment.id }).expect(409);
    await state(first.body._id, 'cancelled', fixture.admin, 'Left').expect(200);
    const returned = await postVisit({ ...intake(), appointment: appointment.id }).expect(201);
    expect(returned.body._id).not.toBe(first.body._id);
    expect((await visits.findById(first.body._id))?.state).toBe('cancelled');
    const pending = await appointments.create({ patient: fixture.patient, dentist: fixture.dentist, clinic: fixture.clinic, date: manilaDay(), startTime: '11:00', endTime: '11:30', status: 'pending' });
    await postVisit({ ...intake(), appointment: pending.id }).expect(409);
    await postVisit({ ...intake(), appointment: appointment.id, patient: fixture.literal }).expect(400);
  });
  it('keeps private queue/details protected and validates dates and states', async () => {
    const first = await postVisit(intake()).expect(201);
    await get(`/care/visits/${first.body._id}`, fixture.patient).expect(403);
    await get(`/care/queue?clinic=${fixture.outside}`, fixture.admin).expect(403);
    await get('/care/queue?date=2026-99-99', fixture.admin).expect(400);
    await state(first.body._id, 'completed', fixture.dentist).expect(400);
    await state(first.body._id, 'waiting', fixture.dentist).expect(400);
  });

  const recordBody = (revision: number, complete = false) => ({ revision, complete, assessment: 'Staff-only assessment', treatments: [{ description: 'Dental examination', tooth: 'Upper', notes: 'Internal findings' }], summary: 'Examination completed. Follow the clinic plan.', aftercare: 'Patient instructions', nextSteps: 'Return for the next session' });
  const saveRecord = (id: string, body: object, actor = fixture.dentist) => request(app.getHttpServer()).put(`/care/visits/${id}/record`).set('x-fixture-user', actor).send(body);
  const postCase = (visit: string, actor = fixture.dentist) => request(app.getHttpServer()).post('/care/cases').set('x-fixture-user', actor).send({ consultationVisit: visit, title: 'Learning treatment plan', plan: 'Consultation followed by treatment sessions', internalNotes: 'Staff-only case findings' });
  const startVisit = async () => {
    const visit = await postVisit(intake()).expect(201);
    return (await state(visit.body._id, 'in_progress', fixture.dentist).expect(200)).body as { _id: string; revision: number };
  };
  it('requires responsible clinical writer and rejects stale or terminal records', async () => {
    const visit = await startVisit();
    await saveRecord(visit._id, recordBody(visit.revision), fixture.admin).expect(403);
    await saveRecord(visit._id, recordBody(visit.revision - 1)).expect(409);
    const saved = await saveRecord(visit._id, recordBody(visit.revision)).expect(200);
    expect(saved.body).toMatchObject({ assessment: 'Staff-only assessment', summary: 'Examination completed. Follow the clinic plan.', revision: visit.revision + 1 });
    await saveRecord(visit._id, { ...recordBody(saved.body.revision, true), summary: ' ' }).expect(400);
    const ended = await saveRecord(visit._id, recordBody(saved.body.revision, true)).expect(200);
    expect(ended.body.state).toBe('completed');
    await saveRecord(visit._id, recordBody(ended.body.revision)).expect(409);
    await postVisit(intake()).expect(201);
  });
  it('completes linked appointments and their summary in one transaction', async () => {
    const appointment = await appointments.create({ patient: fixture.patient, dentist: fixture.dentist, clinic: fixture.clinic, date: manilaDay(), startTime: '10:00', endTime: '10:30', status: 'confirmed' });
    const checked = await postVisit({ ...intake(), appointment: appointment.id, isWalkIn: false }).expect(201);
    const started = await state(checked.body._id, 'in_progress', fixture.dentist).expect(200);
    await saveRecord(checked.body._id, recordBody(started.body.revision, true)).expect(200);
    expect((await appointments.findById(appointment._id))?.status).toBe('completed');
  });
  it('requires performed treatments when completing a treatment session', async () => {
    const visit = await postVisit({ ...intake(), purpose: 'treatment' }).expect(201);
    const started = await state(visit.body._id, 'in_progress', fixture.dentist).expect(200);
    await saveRecord(visit.body._id, { ...recordBody(started.body.revision, true), treatments: [] }).expect(400);
    await saveRecord(visit.body._id, { ...recordBody(started.body.revision), treatments: [{ description: ' ' }] }).expect(400);
  });
  it('creates a consultation-derived case with a unique consultation and scoped linked history', async () => {
    const checked = await postVisit(intake()).expect(201);
    await postCase(checked.body._id).expect(409);
    await state(checked.body._id, 'in_progress', fixture.dentist).expect(200);
    await postCase(checked.body._id, fixture.admin).expect(403);
    const result = await postCase(checked.body._id).expect(201);
    expect(result.body.careCase).toMatchObject({ status: 'active', patient: { _id: fixture.patient }, clinic: { _id: fixture.clinic }, dentist: { _id: fixture.dentist } });
    expect(result.body.visits[0]._id).toBe(checked.body._id);
    await postCase(checked.body._id).expect(409);
    await get(`/care/cases/${result.body.careCase._id}`, fixture.patient).expect(403);
    await get(`/care/cases?clinic=${fixture.outside}`, fixture.admin).expect(403);
  });
  it('keeps active sessions open until their clinical visit is finished, then retains a closed case', async () => {
    const visit = await startVisit();
    const created = await postCase(visit._id).expect(201);
    const id = created.body.careCase._id;
    const close = (revision: number) => request(app.getHttpServer()).patch(`/care/cases/${id}`).set('x-fixture-user', fixture.dentist).send({ revision, status: 'completed' });
    await close(0).expect(409);
    const current = await get(`/care/visits/${visit._id}`, fixture.dentist).expect(200);
    await saveRecord(visit._id, recordBody(current.body.revision, true)).expect(200);
    const closed = await close(0).expect(200);
    expect(closed.body.careCase.status).toBe('completed');
    expect(closed.body.visits).toHaveLength(1);
    await close(1).expect(409);
  });
  const bookSession = (careCase: string, patient = fixture.patient) => request(app.getHttpServer()).post('/appointments').set('x-fixture-user', fixture.dentist).send({ careCase, clinic: fixture.clinic, dentist: fixture.dentist, patient, date: '2026-10-12', startTime: '14:00', endTime: '14:30', services: [fixture.service] });
  it('links future appointments to an active matching case and refuses mismatched or closed cases', async () => {
    const visit = await startVisit();
    const result = await postCase(visit._id).expect(201);
    const id = result.body.careCase._id;
    await bookSession(id, fixture.outsidePatient).expect(400);
    const appointment = await bookSession(id).expect(201);
    expect(appointment.body.careCase).toBe(id);
    const detail = await get(`/care/cases/${id}`, fixture.dentist).expect(200);
    expect(detail.body.appointments[0]._id).toBe(appointment.body._id);
    const current = await get(`/care/visits/${visit._id}`, fixture.dentist).expect(200);
    await saveRecord(visit._id, recordBody(current.body.revision, true)).expect(200);
    await request(app.getHttpServer()).patch(`/care/cases/${id}`).set('x-fixture-user', fixture.dentist).send({ revision: 0, status: 'completed' }).expect(409);
    await request(app.getHttpServer()).patch(`/appointments/${appointment.body._id}/cancel`).set('x-fixture-user', fixture.dentist).send({ reason: 'No further session needed' }).expect(200);
    await request(app.getHttpServer()).patch(`/care/cases/${id}`).set('x-fixture-user', fixture.dentist).send({ revision: 0, status: 'completed' }).expect(200);
    await bookSession(id).expect(409);
  });
  it('inherits the appointment treatment case on check-in and rejects another case identity', async () => {
    const visit = await startVisit();
    const result = await postCase(visit._id).expect(201);
    const current = await get(`/care/visits/${visit._id}`, fixture.dentist).expect(200);
    await saveRecord(visit._id, recordBody(current.body.revision, true)).expect(200);
    const appointment = await appointments.create({ careCase: result.body.careCase._id, patient: fixture.patient, clinic: fixture.clinic, dentist: fixture.dentist, date: manilaDay(), startTime: '13:00', endTime: '13:30', status: 'confirmed', createdBy: fixture.admin });
    const checked = await postVisit({ ...intake(), purpose: 'treatment', appointment: appointment.id }).expect(201);
    expect(checked.body.careCase).toBe(result.body.careCase._id);
    await request(app.getHttpServer()).patch(`/appointments/${appointment.id}/cancel`).set('x-fixture-user', fixture.admin).send({ reason: 'Cancel appointment' }).expect(409);
    await request(app.getHttpServer()).patch(`/appointments/${appointment.id}/complete`).set('x-fixture-user', fixture.dentist).send({}).expect(409);
    await request(app.getHttpServer()).patch(`/appointments/${appointment.id}/reschedule`).set('x-fixture-user', fixture.dentist).send({ date: '2026-10-12', startTime: '14:00', endTime: '14:30', reason: 'Move visit' }).expect(409);
  });
  it('includes visit-only patients in the established directory and prevents destructive identity changes', async () => {
    await postVisit({ ...intake(), patient: fixture.literal }).expect(201);
    const directory = await get('/users/patients', fixture.dentist).expect(200);
    expect(directory.body.some((patient: { _id: string }) => patient._id === fixture.literal)).toBe(true);
    await get(`/users/${fixture.literal}`, fixture.dentist).expect(200);
    await request(app.getHttpServer()).delete(`/users/${fixture.literal}`).set('x-fixture-user', fixture.superAdmin).expect(409);
    await request(app.getHttpServer()).put(`/users/${fixture.literal}`).set('x-fixture-user', fixture.superAdmin).send({ firstName: 'Ana', lastName: 'Literal', username: 'literal.patient', address: 'Manila', role: 'dentist', isWalkIn: false, emailAddress: 'literal@example.test', mobileNumber: '+639171230002' }).expect(409);
  });
});
