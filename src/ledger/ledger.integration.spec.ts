import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Connection, createConnection, Model } from 'mongoose';
import * as request from 'supertest';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { TreatmentCase, TreatmentCaseSchema } from '../care/entities/treatment-case.entity';
import { CareAccessService } from '../care/care-access.service';
import { assignedClinicIds } from '../users/clinic-membership';
import { LedgerAccount, LedgerAccountSchema } from './entities/ledger-account.entity';
import { LedgerEntry, LedgerEntrySchema } from './entities/ledger-entry.entity';
import { InstallmentPlan, InstallmentPlanSchema } from './entities/installment-plan.entity';
import { LedgerService } from './ledger.service';
import { LedgerController } from './ledger.controller';
import { UsersService } from '../users/users.service';
import { UsersController } from '../users/users.controller';
import { manilaDay } from '../care/visit-rules';
import { randomUUID } from 'crypto';
const uri = process.env.TEST_CARE_MONGO_URI;
(uri ? describe : describe.skip)('Manual ledger transaction and HTTP rules', () => {
  let db: Connection; let app: INestApplication; let users: Model<User>; let entries: Model<LedgerEntry>;
  let f: { patient: string; other: string; admin: string; super: string; doctor: string; clinic: string; outside: string };
  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_care_spec?replicaSet=clinica-test') throw new Error('Use the isolated care task database only.');
    db = await createConnection(uri).asPromise();
    users = db.model(User.name, UserSchema); entries = db.model(LedgerEntry.name, LedgerEntrySchema);
    const clinics = db.model(Clinic.name, ClinicSchema); const appts = db.model(Appointment.name, AppointmentSchema);
    const visits = db.model(Visit.name, VisitSchema); const cases = db.model(TreatmentCase.name, TreatmentCaseSchema);
    const accounts = db.model(LedgerAccount.name, LedgerAccountSchema); const plans = db.model(InstallmentPlan.name, InstallmentPlanSchema);
    const access = new CareAccessService(users, appts, visits, entries);
    const guard: CanActivate = { canActivate: async (ctx: ExecutionContext) => {
      const req = ctx.switchToHttp().getRequest<{ headers: Record<string,string>; user?: unknown }>();
      const person = await users.findById(req.headers['x-fixture-user']).lean();
      if (!person) throw new UnauthorizedException();
      req.user = { sub: person._id.toString(), role: person.role, clinics: assignedClinicIds(person) }; return true;
    } };
    const module = await Test.createTestingModule({ controllers: [LedgerController, UsersController], providers: [
      { provide: LedgerService, useValue: new LedgerService(access, accounts, entries, plans, users, clinics, visits, cases, appts) },
      { provide: UsersService, useValue: new UsersService(users, clinics, appts, visits, entries) }, { provide: APP_GUARD, useValue: guard },
    ] }).compile();
    app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true })); await app.init();
  });
  beforeEach(async () => {
    await Promise.all(Object.values(db.models).map(model => model.deleteMany({})));
    const places = await db.model<Clinic>(Clinic.name).create([{ name: 'Here' }, { name: 'Outside' }]);
    const people = await users.create([
      { username: 'patient', firstName: 'Ana', role: 'user', status: 'walk_in', clinics: places.map(p => p._id) },
      { username: 'other', role: 'user', clinics: [places[1]._id] },
      { username: 'admin', firstName: 'Clerk', role: 'admin', clinics: [places[0]._id] },
      { username: 'super', role: 'super-admin' },
      { username: 'doctor', role: 'dentist', clinics: places.map(p => p._id) },
    ]);
    f = { patient: people[0].id, other: people[1].id, admin: people[2].id, super: people[3].id, doctor: people[4].id, clinic: places[0].id, outside: places[1].id };
    await db.model<Appointment>(Appointment.name).create({ patient: f.patient, clinic: f.clinic, dentist: f.doctor, date: '2026-10-03', startTime: '09:00', endTime: '09:30' });
  });
  afterAll(async () => { await app?.close(); await db?.close(); });
  const post = (path: string, body: object, actor = f.admin) => request(app.getHttpServer()).post(path).set('x-fixture-user', actor).send(body);
  const patch = (path: string, body: object, actor = f.admin) => request(app.getHttpServer()).patch(path).set('x-fixture-user', actor).send(body);
  const get = (path: string, actor = f.admin) => request(app.getHttpServer()).get(path).set('x-fixture-user', actor);
  const charge = (extra = {}) => ({ patient: f.patient, clinic: f.clinic, amount: 10000, date: manilaDay(), description: 'Braces installment charge', notes: 'private financial note', operationId: randomUUID(), ...extra });
  const payment = (id: string, amount = 4000, extra = {}) => ({ charge: id, amount, date: manilaDay(), method: 'Cash', operationId: randomUUID(), ...extra });
  it('records immutable manual entries and returns duplicate operation retries once', async () => {
    const dto = charge(); const first = await post('/ledger/charges', dto).expect(201);
    const retry = await post('/ledger/charges', dto).expect(201); expect(retry.body._id).toBe(first.body._id);
    await post('/ledger/charges', { ...dto, amount: 12000 }).expect(409);
    const p = payment(first.body._id, 10000); const one = await post('/ledger/payments', p).expect(201);
    expect((await post('/ledger/payments', p).expect(201)).body._id).toBe(one.body._id);
    expect(await entries.countDocuments()).toBe(2);
    expect((await get(`/ledger/patients/${f.patient}`).expect(200)).body.totals).toMatchObject({ charged: 10000, paid: 10000, balance: 0 });
  });
  it('serializes concurrent payments and prevents overpayment', async () => {
    const c = await post('/ledger/charges', charge()).expect(201);
    const results = await Promise.all([post('/ledger/payments', payment(c.body._id, 7000)), post('/ledger/payments', payment(c.body._id, 7000))]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await entries.countDocuments({ kind: 'payment' })).toBe(1);
  });
  it('preserves reasoned void history and recomputes FIFO installments', async () => {
    const c = await post('/ledger/charges', charge()).expect(201);
    await post('/ledger/installments', { charge: c.body._id, items: [{ dueDate: '2026-01-01', amount: 5000 }, { dueDate: '2099-01-01', amount: 5000 }] }).expect(201);
    const p = await post('/ledger/payments', payment(c.body._id, 6000)).expect(201);
    const view = await get(`/ledger/patients/${f.patient}`).expect(200);
    expect(view.body.plans[0]).toMatchObject({ overdue: 0, upcoming: 4000, items: [{ paid: 5000, remaining: 0 }, { paid: 1000, remaining: 4000 }] });
    await patch(`/ledger/entries/${c.body._id}/void`, { reason: 'Correction' }).expect(409);
    await patch(`/ledger/entries/${p.body._id}/void`, { reason: 'Recorded against wrong receipt' }).expect(200);
    const after = await get(`/ledger/patients/${f.patient}`).expect(200);
    expect(after.body.totals).toMatchObject({ paid: 0, balance: 10000, overdue: 5000 });
    expect(after.body.entries.find((e: { _id: string }) => e._id === p.body._id).voidReason).toBe('Recorded against wrong receipt');
    await patch(`/ledger/entries/${c.body._id}/void`, { reason: 'Wrong charge' }).expect(200);
    expect((await get(`/ledger/patients/${f.patient}`).expect(200)).body.totals.balance).toBe(0);
    expect(await entries.countDocuments()).toBe(2);
  });
  it('validates installments and retains original schedule on reasoned revision', async () => {
    const c = await post('/ledger/charges', charge()).expect(201);
    await post('/ledger/installments', { charge: c.body._id, items: [{ dueDate: '2026-02-30', amount: 10000 }] }).expect(400);
    await post('/ledger/installments', { charge: c.body._id, items: [{ dueDate: '2026-11-01', amount: 9999 }] }).expect(400);
    const plan = await post('/ledger/installments', { charge: c.body._id, items: [{ dueDate: '2026-11-01', amount: 10000 }] }).expect(201);
    await post('/ledger/installments', { charge: c.body._id, items: [{ dueDate: '2026-11-01', amount: 10000 }] }).expect(409);
    await patch(`/ledger/installments/${plan.body._id}`, { revision: 0, reason: 'Agreed later due date', items: [{ dueDate: '2026-12-01', amount: 10000 }] }).expect(200);
    await patch(`/ledger/installments/${plan.body._id}`, { revision: 0, reason: 'Stale', items: [{ dueDate: '2026-12-02', amount: 10000 }] }).expect(409);
    const view = await get(`/ledger/patients/${f.patient}`).expect(200);
    expect(view.body.plans[0].history[0].items[0].dueDate).toBe('2026-11-01');
  });
  it('keeps patients read-only and excludes private actor and financial notes from raw payloads', async () => {
    const c = await post('/ledger/charges', charge()).expect(201);
    await post('/ledger/payments', payment(c.body._id)).expect(201);
    const own = await get('/ledger/my-record', f.patient).expect(200);
    expect(own.body.totals.balance).toBe(6000);
    expect(JSON.stringify(own.body)).not.toMatch(/private financial|actorName|actorRole|operationId|signature|notes|voidedBy|history/);
    await get(`/ledger/patients/${f.patient}`, f.patient).expect(403);
    await post('/ledger/charges', charge(), f.patient).expect(403);
    expect((await get('/ledger/my-record', f.other).expect(200)).body.entries).toEqual([]);
  });
  it('scopes shared patient balances to admin clinics and dentist established care clinics', async () => {
    await post('/ledger/charges', charge()).expect(201);
    await post('/ledger/charges', charge({ clinic: f.outside }), f.super).expect(201);
    expect((await get(`/ledger/patients/${f.patient}`).expect(200)).body.totals.charged).toBe(10000);
    expect((await get(`/ledger/patients/${f.patient}`, f.doctor).expect(200)).body.totals.charged).toBe(10000);
    await get(`/ledger/patients/${f.patient}?clinic=${f.outside}`).expect(403);
    await get(`/ledger/patients/${f.patient}?clinic=${f.outside}`, f.doctor).expect(403);
    await post('/ledger/charges', charge({ clinic: f.outside })).expect(403);
    await post('/ledger/charges', charge(), f.doctor).expect(403);
  });
  it('rejects mismatched care references, unsafe amounts and future manual entries', async () => {
    const visit = await db.model<Visit>(Visit.name).create({ patient: f.other, clinic: f.outside, dentist: f.doctor, date: manilaDay(), checkedInAt: new Date(), purpose: 'consultation', createdBy: f.super });
    await post('/ledger/charges', charge({ visit: visit.id })).expect(400);
    await post('/ledger/charges', charge({ amount: 0 })).expect(400);
    await post('/ledger/charges', charge({ amount: 1.5 })).expect(400);
    await post('/ledger/charges', charge({ date: '2099-01-01' })).expect(400);
    await post('/ledger/charges', charge({ description: '  ' })).expect(400);
  });
  it('retains identity and clinic visibility for patients with ledger-only history', async () => {
    await post('/ledger/charges', charge()).expect(201);
    await users.updateOne({ _id: f.patient }, { $set: { clinics: [] } });
    await db.model<Appointment>(Appointment.name).deleteMany({ patient: f.patient });
    expect((await get('/users/patients').expect(200)).body.some((p: { _id: string }) => p._id === f.patient)).toBe(true);
    await request(app.getHttpServer()).delete(`/users/${f.patient}`).set('x-fixture-user', f.super).expect(409);
  });
});
