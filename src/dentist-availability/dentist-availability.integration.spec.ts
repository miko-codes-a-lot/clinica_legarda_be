import { createConnection, Connection, Model, Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import * as httpRequest from 'supertest';
import { DentistAvailabilityController } from './dentist-availability.controller';
import { DentistAvailabilityService } from './dentist-availability.service';
import { DentistDayAvailability, DentistDayAvailabilitySchema } from './entities/dentist-day-availability.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { Notification, NotificationSchema } from '../notifications/entities/notification.entity';
import { AppointmentChangeEmail, AppointmentChangeEmailSchema } from '../appointment-change-emails/entities/appointment-change-email.entity';

const uri = process.env.CLINICA_PANELIST_TEST_URI;
(uri ? describe : describe.skip)('Dentist dated availability transactions', () => {
  let db: Connection, days: Model<DentistDayAvailability>, appointments: Model<Appointment>, users: Model<User>, clinics: Model<Clinic>,
    catalog: Model<DentalCatalog>, referrals: Model<Referral>, visits: Model<Visit>, notices: Model<Notification>, outbox: Model<AppointmentChangeEmail>;
  let availability: DentistAvailabilityService, booking: AppointmentsService;
  let ids: { dentist: string; patient: string; clinic: string; otherClinic: string; service: string };
  const actor = () => ({ sub: ids.dentist, role: 'dentist', clinics: [ids.clinic, ids.otherClinic] });
  const date = '2026-10-21';
  const payload = () => ({ clinic: ids.clinic, intervals: [{ startTime: '09:00', endTime: '12:00' }, { startTime: '13:00', endTime: '17:00' }], expectedRevision: 0, acknowledgedAppointmentIds: [] as string[] });
  const request = () => ({ ...ids, services: [ids.service], date: new Date(date), startTime: '12:00', endTime: '12:30' });
  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_panelist_spec?replicaSet=clinica-test') throw new Error('Use isolated panelist database only.');
    db = await createConnection(uri).asPromise();
    days = db.model(DentistDayAvailability.name, DentistDayAvailabilitySchema); appointments = db.model(Appointment.name, AppointmentSchema);
    users = db.model(User.name, UserSchema); clinics = db.model(Clinic.name, ClinicSchema); catalog = db.model(DentalCatalog.name, DentalCatalogSchema);
    referrals = db.model(Referral.name, ReferralSchema); visits = db.model(Visit.name, VisitSchema); notices = db.model(Notification.name, NotificationSchema);
    outbox = db.model(AppointmentChangeEmail.name, AppointmentChangeEmailSchema); await Promise.all([days.init(), outbox.init()]);
  });
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-20T00:00:00Z').getTime());
    await Promise.all(Object.values(db.models).map(model => model.deleteMany({})));
    const hours = [{ day: 'wednesday', startTime: '09:00', endTime: '17:00' }];
    const clinic = await clinics.create({ name: 'Availability clinic A', operatingHours: hours });
    const other = await clinics.create({ name: 'Availability clinic B', operatingHours: hours });
    const dentist = await users.create({ role: 'dentist', status: 'confirmed', clinics: [clinic._id, other._id], operatingHours: hours });
    const patient = await users.create({ role: 'user', status: 'confirmed' });
    const treatment = await catalog.create({ name: 'Test treatment', duration: 30, clinics: [clinic._id, other._id] });
    ids = { dentist: dentist.id, patient: patient.id, clinic: clinic.id, otherClinic: other.id, service: treatment.id };
    const scheduling = new AppointmentSchedulingService(appointments, users, clinics, catalog, undefined, days);
    availability = new DentistAvailabilityService(days, users, clinics, appointments, visits, notices, outbox, scheduling, new EventEmitter2());
    booking = new AppointmentsService(appointments, scheduling, referrals, users, undefined, visits, outbox);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await db?.dropDatabase(); await db?.close(); });

  it('saves/reloads breaks, rejects lunch bookings and restores weekly hours with revision protection', async () => {
    const saved = await availability.save(actor(), ids.dentist, date, payload());
    expect(saved.revision).toBe(1);
    expect(await availability.list(actor(), ids.dentist, { clinic: ids.clinic, from: date, to: date })).toHaveLength(1);
    await expect(booking.create(request(), { sub: ids.patient, role: 'user' })).rejects.toThrow('unavailable');
    await expect(availability.save(actor(), ids.dentist, date, payload())).rejects.toThrow('changed');
    await availability.save(actor(), ids.dentist, date, { ...payload(), expectedRevision: 1, restoreWeeklyHours: true });
    expect(await booking.create(request(), { sub: ids.patient, role: 'user' })).toBeDefined();
  });
  it('requires a fresh affected-booking acknowledgement and flags instead of cancelling or moving it', async () => {
    const row = await booking.create(request(), { sub: ids.patient, role: 'user' });
    const preview = await availability.preview(actor(), ids.dentist, date, payload());
    expect(preview.appointments.map(a => a._id.toString())).toEqual([row._id.toString()]);
    await expect(availability.save(actor(), ids.dentist, date, payload())).rejects.toThrow('Review');
    await availability.save(actor(), ids.dentist, date, { ...payload(), acknowledgedAppointmentIds: [row._id.toString()] });
    const current = await appointments.findById(row._id);
    expect(current?.status).toBe('pending'); expect(current?.startTime).toBe('12:00');
    expect(current?.disruption?.dentistAvailability).toHaveLength(1);
    expect(await outbox.countDocuments({ kind: 'disrupted' })).toBe(1);
    expect(await notices.countDocuments()).toBe(2);
  });
  it('can make a whole day unavailable without altering the other clinic', async () => {
    await availability.save(actor(), ids.dentist, date, { ...payload(), intervals: [] });
    await expect(booking.create({ ...request(), startTime: '09:00', endTime: '09:30' }, { sub: ids.patient, role: 'user' })).rejects.toThrow('unavailable');
    expect(await booking.create({ ...request(), clinic: ids.otherClinic, startTime: '09:00', endTime: '09:30' }, { sub: ids.patient, role: 'user' })).toBeDefined();
  });
  it('preserves closure sources when availability is restored and keeps existing treatment intact', async () => {
    const row = await booking.create(request(), { sub: ids.patient, role: 'user' });
    const closure = new Types.ObjectId();
    await appointments.updateOne({ _id: row._id }, { disruption: { closures: [closure], flaggedAt: new Date(), message: 'Closure' } });
    await availability.save(actor(), ids.dentist, date, { ...payload(), acknowledgedAppointmentIds: [row._id.toString()] });
    await availability.save(actor(), ids.dentist, date, { ...payload(), expectedRevision: 1, restoreWeeklyHours: true });
    const current = await appointments.findById(row._id);
    expect(current?.disruption?.closures.map(String)).toEqual([closure.toString()]);
    expect(current?.disruption?.dentistAvailability ?? []).toHaveLength(0);
    await db.collection('visits').insertOne({ appointment: row._id, state: 'in_progress' });
    expect((await availability.preview(actor(), ids.dentist, date, { ...payload(), intervals: [], expectedRevision: 2 })).appointments).toHaveLength(0);
  });
  it('does not disclose or edit another dentist, unassigned clinic or private appointment details', async () => {
    await expect(availability.save({ ...actor(), sub: new Types.ObjectId().toString() }, ids.dentist, date, payload())).rejects.toThrow();
    await expect(availability.save({ ...actor(), clinics: [] }, ids.dentist, date, payload())).rejects.toThrow();
    await availability.save(actor(), ids.dentist, date, payload());
    const publicDays = await availability.publicDays(ids.dentist, { clinic: ids.clinic, from: date, to: date });
    expect(Object.keys(publicDays[0]).sort()).toEqual(['date', 'intervals']);
    expect(await availability.publicDays(ids.dentist, { clinic: ids.otherClinic, from: date, to: date })).toHaveLength(0);
  });
  it('shares locks with booking so a racing lunch booking cannot be missed', async () => {
    const results = await Promise.allSettled([
      availability.save(actor(), ids.dentist, date, payload()), booking.create(request(), { sub: ids.patient, role: 'user' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('reserves the dentist across clinics even with separate dated availability', async () => {
    await booking.create({ ...request(), startTime: '09:00', endTime: '09:30' }, { sub: ids.patient, role: 'user' });
    await availability.save(actor(), ids.dentist, date, { ...payload(), clinic: ids.otherClinic });
    await expect(booking.create({ ...request(), clinic: ids.otherClinic, startTime: '09:00', endTime: '09:30' }, { sub: ids.patient, role: 'user' })).rejects.toThrow('already');
  });
  it('validates HTTP payloads and enforces dentist ownership at the endpoint', async () => {
    const module = await Test.createTestingModule({ controllers: [DentistAvailabilityController], providers: [{ provide: DentistAvailabilityService, useValue: availability }] }).compile();
    const app = module.createNestApplication();
    let currentActor = actor();
    app.use((req: { user: unknown }, _res: unknown, next: () => void) => { req.user = currentActor; next(); });
    await app.init();
    try {
      const url = `/dentist-availability/${ids.dentist}/days/${date}`;
      await httpRequest(app.getHttpServer()).put(url).send({ ...payload(), intervals: [{ startTime: '25:00', endTime: '26:00' }] }).expect(400);
      currentActor = { ...actor(), sub: new Types.ObjectId().toString() };
      await httpRequest(app.getHttpServer()).put(url).send(payload()).expect(403);
      currentActor = actor();
      const saved = await httpRequest(app.getHttpServer()).put(url).send(payload()).expect(200);
      expect(saved.body.revision).toBe(1);
    } finally { await app.close(); }
  });
});
