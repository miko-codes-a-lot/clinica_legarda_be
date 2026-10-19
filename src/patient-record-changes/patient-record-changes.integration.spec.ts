import { createConnection, Connection, Model } from 'mongoose';
import { PatientRecordChange, PatientRecordChangeSchema, PatientRecordAuditState, PatientRecordAuditStateSchema } from './entities/patient-record-change.entity';
import { PatientRecordChangesService } from './patient-record-changes.service';
import { UsersService } from '../users/users.service';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { VisitsService } from '../care/visits.service';
import { CareAccessService } from '../care/care-access.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AnalyticsController } from '../analytics/analytics.controller';

const uri = process.env.CLINICA_PANELIST_TEST_URI;
(uri ? describe : describe.skip)('Patient record audit and period reports', () => {
  let db: Connection, users: Model<User>, clinics: Model<Clinic>, appointments: Model<Appointment>, visits: Model<Visit>,
    changes: Model<PatientRecordChange>, state: Model<PatientRecordAuditState>, referrals: Model<Referral>, catalog: Model<DentalCatalog>;
  let audit: PatientRecordChangesService, profiles: UsersService, care: VisitsService, reports: AnalyticsService;
  let f: { patient: string; dentist: string; clinic: string; outside: string; service: string; admin: string };
  const actor = () => ({ sub: f.admin, role: 'admin', clinics: [f.clinic] });
  const globalActor = () => ({ ...actor(), role: 'super-admin' });
  const profile = () => ({ firstName: 'Ana', lastName: 'Patient', username: 'patient', emailAddress: 'patient@clinic-mail.ph', mobileNumber: '+639171234567', address: 'Manila', role: 'user' });
  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_panelist_spec?replicaSet=clinica-test') throw new Error('Use isolated panelist database only.');
    db = await createConnection(uri).asPromise(); users = db.model(User.name, UserSchema); clinics = db.model(Clinic.name, ClinicSchema);
    appointments = db.model(Appointment.name, AppointmentSchema); visits = db.model(Visit.name, VisitSchema);
    changes = db.model(PatientRecordChange.name, PatientRecordChangeSchema); state = db.model(PatientRecordAuditState.name, PatientRecordAuditStateSchema);
    referrals = db.model(Referral.name, ReferralSchema); catalog = db.model(DentalCatalog.name, DentalCatalogSchema); await changes.init();
  });
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-20T02:00:00Z').getTime());
    await Promise.all(Object.values(db.models).map(model => model.deleteMany({})));
    const [clinic, outside] = await clinics.create([{ name: 'Audit A' }, { name: 'Audit B' }]);
    const patient = await users.create({ ...profile(), role: 'user', status: 'confirmed', clinics: [clinic._id, outside._id] });
    const dentist = await users.create({ role: 'dentist', status: 'confirmed', clinics: [clinic._id] });
    const admin = await users.create({ role: 'admin', clinics: [clinic._id] });
    const service = await catalog.create({ name: 'Cleaning' });
    f = { patient: patient.id, dentist: dentist.id, clinic: clinic.id, outside: outside.id, service: service.id, admin: admin.id };
    audit = new PatientRecordChangesService(changes, state); await audit.onModuleInit();
    profiles = new UsersService(users, clinics, appointments, visits, audit);
    care = new VisitsService(new CareAccessService(users, appointments, visits), visits, users, clinics, appointments, undefined, undefined, audit);
    reports = new AnalyticsService(appointments, referrals, audit);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await db?.dropDatabase(); await db?.close(); });

  it('saves and clears optional details, audits real edits and preserves access boundaries', async () => {
    const details = { birthDate: '2000-02-29', sex: ' Female ', occupation: ' Student ', religion: '', maritalStatus: ' Single ' };
    await profiles.upsert({ ...profile(), ...details }, f.patient, actor());
    const saved = await users.findById(f.patient); expect(saved?.occupation).toBe('Student'); expect(saved?.birthDate).toBe('2000-02-29');
    await profiles.upsert({ ...profile(), ...details }, f.patient, actor());
    expect(await changes.countDocuments()).toBe(1);
    const access = new CareAccessService(users, appointments, visits);
    await expect(access.requirePatient({ sub: f.dentist, role: 'dentist', clinics: [f.clinic] }, f.patient, f.clinic)).rejects.toThrow();
    await appointments.create({ patient: f.patient, dentist: f.dentist, clinic: f.clinic, date: new Date('2026-10-20'), startTime: '09:00', endTime: '09:30', services: [], status: 'pending', createdBy: f.patient });
    const visible = await access.requirePatient({ sub: f.dentist, role: 'dentist', clinics: [f.clinic] }, f.patient, f.clinic);
    expect(visible.birthDate).toBe('2000-02-29');
    await expect(profiles.upsert({ ...profile(), birthDate: '2025-02-29' }, f.patient, actor())).rejects.toThrow();
    await expect(profiles.upsert({ ...profile(), role: 'super-admin', birthDate: '2000-02-29' }, f.patient, { sub: f.patient, role: 'user' })).rejects.toThrow();
    await profiles.upsert({ ...profile(), birthDate: '', occupation: '' }, f.patient, actor());
    expect((await users.findById(f.patient))?.birthDate).toBeUndefined();
  });
  it('records real profile changes once, excludes credentials/activity and scopes shared-patient edits to the acting clinic', async () => {
    await profiles.upsert({ ...profile(), address: 'New address' }, f.patient, actor());
    await profiles.upsert({ ...profile(), address: 'New address' }, f.patient, actor());
    await users.updateOne({ _id: f.patient }, { $inc: { scheduleRevision: 1 }, $set: { otpVerifiedAt: new Date() } }, { timestamps: false });
    expect(await changes.countDocuments()).toBe(1);
    const change = await changes.findOne(); expect(change?.fields).toEqual(['address']); expect(change?.clinicScope.map(String)).toEqual([f.clinic]);
    expect(JSON.stringify(change)).not.toContain('New address'); expect(JSON.stringify(change)).not.toMatch(/password|resetOtp|otpVerifiedAt|scheduleRevision/);
    const all = await reports.getReport('all', globalActor(), { period: 'month', anchor: '2026-10-20' });
    expect(all.patientRecordChanges).toMatchObject({ events: 1, patients: 1 });
    const outside = await reports.getReport(f.outside, globalActor(), { period: 'month', anchor: '2026-10-20' });
    expect(outside.patientRecordChanges.events).toBe(0);
  });
  it('audits clinical changes, leaves an unchanged save uncounted and rolls back failed audit writes', async () => {
    const visit = await visits.create({ patient: f.patient, dentist: f.dentist, clinic: f.clinic, state: 'in_progress', date: '2026-10-20', checkedInAt: new Date(), purpose: 'consultation', createdBy: f.admin });
    const dentist = { sub: f.dentist, role: 'dentist', clinics: [f.clinic] };
    const record = { revision: 0, assessment: 'PRIVATE_ASSESSMENT', treatments: [], summary: 'Summary', aftercare: '', nextSteps: '', complete: false };
    await care.saveRecord(dentist, visit.id, record);
    await care.saveRecord(dentist, visit.id, { ...record, revision: 1 });
    expect(await changes.countDocuments()).toBe(1); expect(JSON.stringify(await changes.findOne())).not.toContain('PRIVATE_ASSESSMENT');
    jest.spyOn(changes, 'create').mockRejectedValueOnce(new Error('Audit unavailable'));
    await expect(care.saveRecord(dentist, visit.id, { ...record, revision: 2, summary: 'Changed' })).rejects.toThrow('Audit unavailable');
    expect((await visits.findById(visit._id))?.summary).toBe('Summary');
  });
  it('rolls profile changes back if the audit fails and ignores an unchanged profile picture', async () => {
    const fail = jest.spyOn(changes, 'create').mockRejectedValueOnce(new Error('Audit unavailable'));
    await expect(profiles.upsert({ ...profile(), address: 'Changed' }, f.patient, actor())).rejects.toThrow('Audit unavailable');
    expect((await users.findById(f.patient))?.address).toBe('Manila'); fail.mockRestore();
    await profiles.updateProfilePicture(f.patient, 'patient-photo.png', actor());
    await profiles.updateProfilePicture(f.patient, 'patient-photo.png', actor());
    expect(await changes.countDocuments()).toBe(1); expect((await changes.findOne())?.fields).toEqual(['profilePicture']);
  });
  it('keeps audit coverage durable across restarts, filters secret fields and preserves immutable history', async () => {
    const coverage = await audit.coverage();
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-21T00:00:00Z').getTime());
    expect(await new PatientRecordChangesService(changes, state).coverage()).toBe(coverage);
    await db.transaction(session => audit.recordPatientChange(session, { patient: f.patient, clinicScope: [f.clinic], actor: actor(), kind: 'profile', fields: ['address','password','resetOtp'], sourceEventId: 'allowed-only' }));
    const row = await changes.findOne();
    await changes.updateOne({ _id: row!._id }, { $set: { fields: ['password'], createdAt: new Date('2020-01-01') } });
    const current = await changes.findOne(); expect(current?.fields).toEqual(['address']); expect(current?.createdAt).toEqual(row?.createdAt);
  });
  it('uses real audit timestamp boundaries and zero-filled buckets independently of appointment updates', async () => {
    await changes.create([{ patient: f.patient, clinicScope: [f.clinic], actorId: f.admin, actorRole: 'admin', kind: 'profile', fields: ['address'], sourceEventId: 'before', createdAt: new Date('2026-09-30T15:59:59Z') },
      { patient: f.patient, clinicScope: [f.clinic], actorId: f.admin, actorRole: 'admin', kind: 'profile', fields: ['address'], sourceEventId: 'inside', createdAt: new Date('2026-09-30T16:00:00Z') },
      { patient: f.patient, clinicScope: [f.clinic], actorId: f.admin, actorRole: 'admin', kind: 'profile', fields: ['address'], sourceEventId: 'after', createdAt: new Date('2026-10-31T16:00:00Z') }]);
    const report = await reports.getReport(f.clinic, actor(), { period: 'month', anchor: '2026-10-20' });
    expect(report.totalAppointments).toBe(0); expect(report.patientRecordChanges.events).toBe(1); expect(report.patientRecordChanges.counts[0]).toBe(1);
    expect(report.patientRecordChanges.counts).toHaveLength(31); expect(report.patientRecordChanges.counts.reduce((a,b) => a+b,0)).toBe(1);
    expect(report.patientRecordChanges.coverageFrom).toBeTruthy();
    expect(report.completedShare).toBe(0); expect(report.noShowRate).toBe(0);
  });
  it('counts all statuses, unique patients, distinct requested services and labelled outcome rates', async () => {
    await appointments.create(['pending','confirmed','cancelled','rejected','completed','no_show'].map(status => ({ clinic: f.clinic, patient: f.patient, dentist: f.dentist, date: new Date('2026-10-21'), startTime: '09:00', endTime: '09:30', services: [f.service,f.service], status })));
    await appointments.create({ clinic: f.outside, patient: f.patient, dentist: f.dentist, date: new Date('2026-10-21'), startTime: '09:00', endTime: '09:30', services: [f.service], status: 'completed' });
    const report = await reports.getReport('all', actor(), { period: 'year', anchor: '2026-10-20' });
    expect(report.totalAppointments).toBe(6); expect(report.uniquePatients).toBe(1); expect(report.preferredServices).toEqual({ Cleaning: 6 });
    expect(report.completedShare).toBeCloseTo(1/6); expect(report.noShowRate).toBe(.5); expect(report.statuses.no_show).toBe(1);
    expect(report.trend.appointments).toHaveLength(12); expect(report.trend.appointments[9]).toBe(6);
    expect(report.metricDefinitions.noShowRate).toContain('resolved outcomes');
    await expect(reports.getReport(f.outside, actor(), { period: 'week' })).rejects.toThrow('outside');
    await expect(reports.getReport('all', { sub: f.patient, role: 'user' }, { period: 'week' })).rejects.toThrow();
  });
  it('validates report queries at HTTP and returns one clinic/period-qualified snapshot', async () => {
    const module = await Test.createTestingModule({ controllers: [AnalyticsController], providers: [{ provide: AnalyticsService, useValue: reports }] }).compile();
    const app = module.createNestApplication();
    app.use((req: { user: unknown }, _res: unknown, next: () => void) => { req.user = actor(); next(); }); await app.init();
    try {
      for (const query of ['period=day','anchor=2026-02-29','anchor=1900-01-01','anchor=2026-10-20T00:00:00Z'])
        await request(app.getHttpServer()).get(`/analytics/report/${f.clinic}?${query}`).expect(400);
      await request(app.getHttpServer()).get(`/analytics/report/${f.outside}`).expect(403);
      const response = await request(app.getHttpServer()).get(`/analytics/report/${f.clinic}?period=month&anchor=2026-10-20`).expect(200);
      expect(response.body.period).toMatchObject({ kind: 'month', start: '2026-10-01', end: '2026-10-31' });
      expect(JSON.stringify(response.body)).not.toContain(f.patient);
    } finally { await app.close(); }
  });
});
