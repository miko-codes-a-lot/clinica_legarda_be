import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { DentalChartsController } from './dental-charts.controller';
import { assignedClinicIds } from '../users/clinic-membership';
import * as request from 'supertest';
import { PatientRecordsService } from '../care/patient-records.service';
import { TreatmentCase, TreatmentCaseSchema } from '../care/entities/treatment-case.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { Connection, createConnection, Model } from 'mongoose';
import { DentalChartsService } from './dental-charts.service';
import { DentalChart, DentalChartSchema, DentalChartVersion, DentalChartVersionSchema } from './entities/dental-chart.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { CareAccessService } from '../care/care-access.service';
import { UsersService } from '../users/users.service';
import { PatientRecordChange, PatientRecordChangeSchema, PatientRecordAuditState, PatientRecordAuditStateSchema } from '../patient-record-changes/entities/patient-record-change.entity';
import { PatientRecordChangesService } from '../patient-record-changes/patient-record-changes.service';
import { UserActor } from '../auth/role-policy';
const uri = process.env.CLINICA_PANELIST_TEST_URI;
(uri ? describe : describe.skip)('Scoped versioned dental charts', () => {
  let db: Connection, charts: Model<DentalChart>, versions: Model<DentalChartVersion>, users: Model<User>, clinics: Model<Clinic>, appointments: Model<Appointment>, visits: Model<Visit>, changes: Model<PatientRecordChange>;
  let service: DentalChartsService, audit: PatientRecordChangesService, profiles: UsersService;
  let f: { patient: string; sibling: string; dentist: string; secondDentist: string; clinic: string; outside: string; admin: string; superAdmin: string };
  const dentist = (): UserActor => ({ sub: f.dentist, role: 'dentist', clinics: [f.clinic] });
  const admin = (): UserActor => ({ sub: f.admin, role: 'admin', clinics: [f.clinic] });
  const global = (): UserActor => ({ sub: f.superAdmin, role: 'super-admin' });
  const payload = (revision = 0) => ({ clinic: f.clinic, dentition: 'permanent' as const, expectedRevision: revision, teeth: [{ tooth: 11, observation: 'Clinician observation', notes: 'Internal clinical note' }] });
  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_panelist_spec?replicaSet=clinica-test') throw new Error('Use isolated panelist database only.');
    db = await createConnection(uri).asPromise(); db.model(TreatmentCase.name, TreatmentCaseSchema); db.model(DentalCatalog.name, DentalCatalogSchema); users = db.model(User.name, UserSchema); clinics = db.model(Clinic.name, ClinicSchema); appointments = db.model(Appointment.name, AppointmentSchema); visits = db.model(Visit.name, VisitSchema);
    charts = db.model(DentalChart.name, DentalChartSchema); versions = db.model(DentalChartVersion.name, DentalChartVersionSchema); changes = db.model(PatientRecordChange.name, PatientRecordChangeSchema);
    const state = db.model(PatientRecordAuditState.name, PatientRecordAuditStateSchema); audit = new PatientRecordChangesService(changes, state); await charts.init(); await versions.init(); await changes.init();
    service = new DentalChartsService(charts, versions, users, clinics, new CareAccessService(users, appointments, visits), audit);
    profiles = new UsersService(users, clinics, appointments, visits, audit, charts, versions);
  });
  beforeEach(async () => {
    await Promise.all(Object.values(db.models).map(model => model.deleteMany({})));
    const places = await clinics.create([{ name: 'Chart clinic' }, { name: 'Outside clinic' }]);
    const people = await users.create([{ firstName: 'Alice', lastName: 'Child', role: 'user', status: 'confirmed', isDependent: true, loginEnabled: false, clinics: [places[0]._id] }, { firstName: 'Bob', lastName: 'Child', role: 'user', status: 'confirmed', clinics: [places[0]._id] },
      { firstName: 'One', lastName: 'Dentist', role: 'dentist', status: 'confirmed', clinics: [places[0]._id] }, { firstName: 'Two', lastName: 'Dentist', role: 'dentist', status: 'confirmed', clinics: [places[0]._id] }, { role: 'admin', clinics: [places[0]._id] }, { role: 'super-admin' }]);
    f = { patient: people[0].id, sibling: people[1].id, dentist: people[2].id, secondDentist: people[3].id, admin: people[4].id, superAdmin: people[5].id, clinic: places[0].id, outside: places[1].id };
    await appointments.create({ patient: f.patient, dentist: f.dentist, clinic: f.clinic, date: new Date('2026-10-21'), startTime: '09:00', endTime: '09:30', status: 'confirmed', services: [], createdBy: f.admin });
  });
  afterAll(async () => { await db?.dropDatabase(); await db?.close(); });
  it('saves independent dentitions, retains original snapshots and audits only actual changes', async () => {
    const first = await service.save(dentist(), f.patient, payload()); expect(first.chart?.revision).toBe(1); expect(String(first.chart?.updatedBy._id)).toBe(f.dentist);
    await service.save(dentist(), f.patient, payload(1)); expect(await changes.countDocuments()).toBe(1); expect(await versions.countDocuments()).toBe(1);
    await service.save(dentist(), f.patient, { ...payload(1), teeth: [{ tooth: 11, observation: 'Updated observation', notes: '' }] });
    await service.save(dentist(), f.patient, { ...payload(), dentition: 'primary', teeth: [{ tooth: 51, observation: 'Primary observation', notes: '' }] });
    const old = await service.read(dentist(), f.patient, { clinic: f.clinic, dentition: 'permanent', revision: 1 });
    expect(old.chart?.teeth[0].observation).toBe('Clinician observation'); expect(old.currentRevision).toBe(2); expect(old.history).toHaveLength(2);
    expect(await charts.countDocuments()).toBe(2); expect(await versions.countDocuments()).toBe(3); expect(await changes.countDocuments()).toBe(3);
    expect(JSON.stringify(await changes.find())).not.toContain('Internal clinical note');
  });
  it('enforces patient, clinic and clinician authority and does not publish internal charts', async () => {
    await expect(service.save(admin(), f.patient, payload())).rejects.toThrow();
    await expect(service.save({ ...dentist(), sub: f.secondDentist }, f.patient, payload())).rejects.toThrow();
    await expect(service.save(dentist(), f.sibling, payload())).rejects.toThrow();
    await expect(service.read({ sub: f.patient, role: 'user', patientIds: [f.sibling] }, f.patient, { clinic: f.clinic, dentition: 'permanent' })).rejects.toThrow();
    await expect(service.save(dentist(), f.patient, { ...payload(), clinic: f.outside })).rejects.toThrow();
    await service.save(global(), f.sibling, { ...payload(), dentition: 'primary', teeth: [{ tooth: 51, observation: 'Sibling observation', notes: '' }] });
    expect((await service.read(admin(), f.patient, { clinic: f.clinic, dentition: 'primary' })).chart).toBeNull();
    await users.updateOne({ _id: f.dentist }, { $set: { clinics: [] } });
    await expect(service.save(dentist(), f.patient, payload())).rejects.toThrow();
  });
  it('keeps clinic charts out of broader exports when the dentist has no patient relationship there', async () => {
    await service.save(dentist(), f.patient, payload());
    await users.updateOne({ _id: f.patient }, { $set: { clinics: [f.clinic, f.outside] } });
    await service.save(global(), f.patient, { ...payload(), clinic: f.outside, teeth: [{ tooth: 12, observation: 'OUTSIDE_CHART', notes: '' }] });
    await users.updateOne({ _id: f.dentist }, { $set: { clinics: [f.clinic, f.outside] } });
    const clinician = { ...dentist(), clinics: [f.clinic, f.outside] };
    await expect(service.read(clinician, f.patient, { clinic: f.outside, dentition: 'permanent' })).rejects.toThrow();
    const records = new PatientRecordsService(new CareAccessService(users, appointments, visits), users, appointments, visits, db.model<TreatmentCase>(TreatmentCase.name), clinics, charts);
    const report = await records.report(clinician, f.patient); expect(report.charts).toHaveLength(1); expect(JSON.stringify(report)).not.toContain('OUTSIDE_CHART');
    const all = await records.report(global(), f.patient); expect(all.charts).toHaveLength(2);
  });
  it('validates chart HTTP input and denies patient or administrator clinical writes', async () => {
    const guard: CanActivate = { canActivate: async (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest<{ headers: Record<string,string>; user?: UserActor }>();
      const id = req.headers['x-fixture-user']; if (!id) throw new UnauthorizedException();
      const person = await users.findById(id).lean(); if (!person) throw new UnauthorizedException();
      req.user = { sub: id, role: person.role, clinics: assignedClinicIds(person) }; return true;
    } };
    const module = await Test.createTestingModule({ controllers: [DentalChartsController], providers: [{ provide: DentalChartsService, useValue: service }, { provide: APP_GUARD, useValue: guard }] }).compile();
    const app = module.createNestApplication(); await app.init();
    try {
      await request(app.getHttpServer()).get('/dental-charts/clinics').set('x-fixture-user', f.patient).expect(403);
      await request(app.getHttpServer()).put(`/dental-charts/${f.patient}`).set('x-fixture-user', f.admin).send(payload()).expect(403);
      await request(app.getHttpServer()).put(`/dental-charts/${f.patient}`).set('x-fixture-user', f.dentist).send({ ...payload(), teeth: [{ tooth: 99, observation: 'Invalid' }] }).expect(400);
      await request(app.getHttpServer()).put(`/dental-charts/${f.patient}`).set('x-fixture-user', f.dentist).send({ ...payload(), expectedRevision: -1 }).expect(400);
      const saved = await request(app.getHttpServer()).put(`/dental-charts/${f.patient}`).set('x-fixture-user', f.dentist).send({ ...payload(), updatedBy: f.admin }).expect(200);
      expect(saved.body.chart.updatedBy._id).toBe(f.dentist);
      const optionalNotes = { ...payload(), dentition: 'primary', teeth: [{ tooth: 51, observation: 'Primary observation' }] };
      const primary = await request(app.getHttpServer()).put(`/dental-charts/${f.patient}`).set('x-fixture-user', f.dentist).send(optionalNotes).expect(200);
      expect(primary.body.chart.teeth[0].notes).toBe('');
      await request(app.getHttpServer()).put(`/dental-charts/${f.patient}`).set('x-fixture-user', f.dentist).send(optionalNotes).expect(409);
      await request(app.getHttpServer()).get(`/dental-charts/${f.patient}?clinic=${f.clinic}&dentition=permanent&revision=1`).set('x-fixture-user', f.patient).expect(403);
      await request(app.getHttpServer()).get(`/dental-charts/${f.patient}?clinic=${f.clinic}&dentition=permanent&revision=-1`).set('x-fixture-user', f.dentist).expect(400);
    } finally { await app.close(); }
  });
  it('rejects stale or racing saves and preserves patient and author identities on deletion', async () => {
    const results = await Promise.allSettled([service.save(dentist(), f.patient, payload()), service.save(dentist(), f.patient, payload())]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(await versions.countDocuments()).toBe(1);
    await expect(service.save(dentist(), f.patient, payload())).rejects.toThrow();
    await expect(profiles.delete(f.patient, global())).rejects.toThrow();
    await expect(profiles.delete(f.dentist, global())).rejects.toThrow();
    await service.save(global(), f.patient, { ...payload(1), teeth: [] });
    await expect(profiles.delete(f.dentist, global())).rejects.toThrow();
    expect(await users.exists({ _id: f.patient })).toBeTruthy(); expect(await versions.countDocuments()).toBe(2);
  });
});
