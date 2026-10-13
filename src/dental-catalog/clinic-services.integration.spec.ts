import { Reason, ReasonDocument, ReasonSchema } from '../reason/entities/reason.entity';
import { ReasonController } from '../reason/reason.controller';
import { ReasonService } from '../reason/reason.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Connection, createConnection, Model, Types } from 'mongoose';
import * as request from 'supertest';
import { DentalCatalog, DentalCatalogSchema } from './entities/dental-catalog.entity';
import { DentalCatalogController } from './dental-catalog.controller';
import { DentalCatalogService } from './dental-catalog.service';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';

const uri = process.env.TEST_CATALOG_MONGO_URI;
const isolated = uri ? describe : describe.skip;

// Losing scope enforcement exposes B services or lets A overwrite B's catalog.
isolated('Clinic-specific services', () => {
  let app: INestApplication;
  let connection: Connection;
  let catalog: Model<DentalCatalog>;
  let clinics: Model<Clinic>;
  let appointments: Model<Appointment>;
  let users: Model<User>;
  let reasons: Model<Reason>;
  let scheduling: AppointmentSchedulingService;
  let fixture: { a: string; b: string; own: string; outside: string; shared: string; legacy: string; unavailable: string; dentist: string; patient: string };
  const hours = [{ day: 'monday', startTime: '08:00', endTime: '18:00' }];

  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_catalog_test?replicaSet=clinica-test') throw new Error('Use only isolated catalog MongoDB.');
    connection = await createConnection(uri).asPromise();
    catalog = connection.model(DentalCatalog.name, DentalCatalogSchema);
    clinics = connection.model(Clinic.name, ClinicSchema);
    appointments = connection.model(Appointment.name, AppointmentSchema);
    users = connection.model(User.name, UserSchema);
    await Promise.all([catalog.init(), clinics.init(), appointments.init(), users.init()]);
    reasons = connection.model(Reason.name, ReasonSchema);
    scheduling = new AppointmentSchedulingService(appointments, users, clinics, catalog);
    const module = await Test.createTestingModule({
      controllers: [DentalCatalogController, ReasonController], providers: [
        DentalCatalogService,
        { provide: ReasonService, useValue: new ReasonService(reasons as unknown as Model<ReasonDocument>) },
        { provide: getModelToken(DentalCatalog.name), useValue: catalog },
        { provide: getModelToken(Clinic.name), useValue: clinics },
        { provide: APP_GUARD, useValue: { canActivate(context) {
          const req = context.switchToHttp().getRequest();
          const role = req.headers['x-role'] ?? 'admin';
          req.user = { sub: new Types.ObjectId().toHexString(), role, clinics: role === 'admin' ? [fixture.a] : [] };
          return true;
        } } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });
  beforeEach(async () => {
    await Promise.all([catalog.deleteMany({}), reasons.deleteMany({}), clinics.deleteMany({}), appointments.deleteMany({}), users.deleteMany({})]);
    const places = await clinics.create([{ name: 'Fixture A', operatingHours: hours }, { name: 'Fixture B', operatingHours: hours }]);
    const docs = [
      { name: 'A cleaning', duration: 30, clinics: [places[0]._id] },
      { name: 'B filling', duration: 60, clinics: [places[1]._id] },
      { name: 'Shared treatment', duration: 45, clinics: places.map(place => place._id) },
      { name: 'Legacy treatment', duration: 90 },
      { name: 'Unavailable treatment', duration: 30, clinics: [] },
    ].map(doc => ({ _id: new Types.ObjectId(), ...doc }));
    await catalog.collection.insertMany(docs);
    const people = await users.create([
      { role: 'dentist', status: 'confirmed', clinics: places.map(place => place._id), operatingHours: hours },
      { role: 'user', status: 'confirmed' },
    ]);
    fixture = { a: places[0].id, b: places[1].id, own: docs[0]._id.toHexString(), outside: docs[1]._id.toHexString(), shared: docs[2]._id.toHexString(), legacy: docs[3]._id.toHexString(), unavailable: docs[4]._id.toHexString(), dentist: people[0].id, patient: people[1].id };
  });
  afterAll(async () => { await app?.close(); await connection?.close(); });
  const get = (path = '/dental-catalog', role = 'admin') => request(app.getHttpServer()).get(path).set('x-role', role);
  const put = (id: string, body: Record<string, unknown>, role = 'admin') => request(app.getHttpServer()).put(`/dental-catalog/${id}`).set('x-role', role).send(body);

  it('shows admins only overlapping services and hides outside assignments', async () => {
    const result = await get().expect(200);
    expect(result.body.map((row: { _id: string }) => row._id).sort()).toEqual([fixture.own, fixture.shared, fixture.legacy].sort());
    const shared = result.body.find((row: { _id: string }) => row._id === fixture.shared);
    expect(shared.clinics).toEqual([fixture.a]);
    expect(shared.canEditDetails).toBe(false);
    await get(`/dental-catalog/${fixture.outside}`).expect(403);
    await get(`/dental-catalog?clinic=${fixture.b}`).expect(403);
  });

  it('lets super-admin see unavailable services and manage every clinic', async () => {
    expect((await get('/dental-catalog', 'super-admin').expect(200)).body).toHaveLength(5);
    await put(fixture.outside, { name: 'B replacement', duration: 60, clinics: [fixture.a, fixture.b] }, 'super-admin').expect(200);
    expect((await catalog.collection.findOne({ _id: new Types.ObjectId(fixture.outside) }))?.clinics).toEqual([new Types.ObjectId(fixture.a), new Types.ObjectId(fixture.b)]);
  });

  it('filters patient booking catalog for the selected clinic and retains absent-only legacy fallback', async () => {
    const result = await get(`/dental-catalog?clinic=${fixture.b}`, 'user').expect(200);
    expect(result.body.map((row: { _id: string }) => row._id).sort()).toEqual([fixture.outside, fixture.shared, fixture.legacy].sort());
  });

  it('rejects nonstaff writes and unknown, duplicate or outside clinic assignments', async () => {
    const body = { name: 'New treatment', duration: 30, clinics: [fixture.a] };
    await request(app.getHttpServer()).post('/dental-catalog').set('x-role', 'user').send(body).expect(403);
    await request(app.getHttpServer()).post('/dental-catalog').set('x-role', 'dentist').send(body).expect(403);
    await request(app.getHttpServer()).post('/dental-catalog').send({ ...body, clinics: [fixture.b] }).expect(403);
    await request(app.getHttpServer()).post('/dental-catalog').set('x-role', 'super-admin').send({ ...body, clinics: [new Types.ObjectId().toHexString()] }).expect(400);
    await request(app.getHttpServer()).post('/dental-catalog').send({ ...body, clinics: [fixture.a, fixture.a] }).expect(400);
    expect(await catalog.countDocuments()).toBe(5);
  });

  it('stores explicit assignments on create and lets admin edit their exclusive service', async () => {
    const created = await request(app.getHttpServer()).post('/dental-catalog').send({ name: 'A new treatment', duration: 15, clinics: [fixture.a] }).expect(201);
    expect(created.body.clinics).toEqual([fixture.a]);
    await put(fixture.own, { name: 'A new cleaning', duration: 40, clinics: [fixture.a] }).expect(200);
    expect((await catalog.findById(fixture.own))?.duration).toBe(40);
  });

  it('preserves outside assignments while rejecting shared detail changes', async () => {
    await put(fixture.shared, { name: 'Renamed shared treatment', duration: 45, clinics: [fixture.a] }).expect(403);
    await put(fixture.shared, { name: 'Shared treatment', duration: 46, clinics: [fixture.a] }).expect(403);
    await put(fixture.shared, { name: 'Shared treatment', duration: 45, clinics: [] }).expect(200);
    const saved = await catalog.collection.findOne({ _id: new Types.ObjectId(fixture.shared) });
    expect(saved?.clinics).toEqual([new Types.ObjectId(fixture.b)]);
    expect(saved?.name).toBe('Shared treatment');
    expect(saved?.duration).toBe(45);
  });

  it('requires explicit clinics for new services and validates service references', async () => {
    await request(app.getHttpServer()).post('/dental-catalog').send({ name: 'Unassigned new', duration: 30 }).expect(400);
    await get('/dental-catalog/not-an-id').expect(400);
    await get('/dental-catalog?clinic=bad-id', 'super-admin').expect(400);
    await put(new Types.ObjectId().toHexString(), { name: 'Missing service', duration: 30, clinics: [fixture.a] }, 'super-admin').expect(404);
  });

  it('restricts global reason management to staff while retaining booking reads', async () => {
    const reason = await reasons.create({ code: 'FIXTURE_REASON', label: 'Fixture reason' });
    await request(app.getHttpServer()).get('/reasons').set('x-role', 'user').expect(200);
    for (const role of ['user', 'dentist']) {
      await request(app.getHttpServer()).post('/reasons').set('x-role', role).send({ code: 'FORGED', label: 'Forged' }).expect(403);
      await request(app.getHttpServer()).put(`/reasons/${reason.id}`).set('x-role', role).send({ label: 'Forged' }).expect(403);
      await request(app.getHttpServer()).patch(`/reasons/${reason.id}/toggle`).set('x-role', role).expect(403);
    }
    await request(app.getHttpServer()).put(`/reasons/${reason.id}`).set('x-role', 'super-admin').send({ label: 'Staff revision' }).expect(200);
    expect((await reasons.findById(reason.id))?.label).toBe('Staff revision');
    expect((await reasons.findById(reason.id))?.isActive).toBe(true);
  });

  const booking = (services: string[]) => ({ dentist: fixture.dentist, patient: fixture.patient, clinic: fixture.a, date: new Date('2030-10-14'), startTime: '09:00', endTime: '10:00', services });
  it.each(['outside', 'unavailable'] as const)('rejects a forged %s booking service before persistence', async key => {
    await expect(scheduling.withLocks([fixture.dentist, fixture.patient], session => scheduling.validate(booking([fixture[key]]), session))).rejects.toThrow('not available at the selected clinic');
    expect(await appointments.countDocuments()).toBe(0);
  });

  it('retains legacy global availability without rewriting stored IDs or duration', async () => {
    await expect(scheduling.withLocks([fixture.dentist, fixture.patient], session => scheduling.validate({ ...booking([fixture.legacy]), endTime: '10:30' }, session))).resolves.toMatchObject({ services: [fixture.legacy] });
    const legacy = await catalog.collection.findOne({ _id: new Types.ObjectId(fixture.legacy) });
    expect(legacy?.duration).toBe(90);
    expect(legacy).not.toHaveProperty('clinics');
  });

  it('gives an unassigned admin no catalog access', async () => {
    const actor = { sub: fixture.patient, role: 'admin', clinics: [] };
    const service = app.get(DentalCatalogService);
    expect(await service.findAll(actor)).toEqual([]);
    await expect(service.findOne(fixture.legacy, actor)).rejects.toThrow('outside your clinic');
    await expect(service.upsert({ name: 'Forged treatment', duration: 30, clinics: [fixture.a] }, undefined, actor)).rejects.toThrow('outside your assignments');
    expect(await catalog.countDocuments()).toBe(5);
  });

  it('continues counting historical service duration after clinic availability changes', async () => {
    await appointments.create({ ...booking([fixture.outside]), endTime: '09:30', status: 'confirmed' });
    const next = { ...booking([fixture.own]), startTime: '09:45', endTime: '10:15' };
    await expect(scheduling.withLocks([fixture.dentist, fixture.patient], session => scheduling.validate(next, session))).rejects.toThrow('Dentist already');
    expect((await appointments.findOne())?.services.map(id => id.toString())).toEqual([fixture.outside]);
    expect((await catalog.findById(fixture.outside))?.duration).toBe(60);
  });
});
