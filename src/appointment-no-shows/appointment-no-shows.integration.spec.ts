import { createConnection, Connection, Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { AppointmentNoShowsService } from './appointment-no-shows.service';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { TreatmentCase, TreatmentCaseSchema } from '../care/entities/treatment-case.entity';
import { CareAccessService } from '../care/care-access.service';
import { VisitsService } from '../care/visits.service';
import { ClinicClosure, ClinicClosureSchema } from '../clinic-closures/entities/clinic-closure.entity';
import { DentistDayAvailability, DentistDayAvailabilitySchema } from '../dentist-availability/entities/dentist-day-availability.entity';

const uri = process.env.CLINICA_PANELIST_TEST_URI;
(uri ? describe : describe.skip)('Automatic No-show transactions', () => {
  let db: Connection, appointments: Model<Appointment>, users: Model<User>, clinics: Model<Clinic>, visits: Model<Visit>, catalog: Model<DentalCatalog>, referrals: Model<Referral>,
    cases: Model<TreatmentCase>, closures: Model<ClinicClosure>, days: Model<DentistDayAvailability>;
  let scheduling: AppointmentSchedulingService, booking: AppointmentsService, care: VisitsService;
  let f: { clinic: string; dentist: string; patient: string; service: string };
  const config = () => new ConfigService({ appointmentNoShows: { enabled: true, enforceFrom: '2026-10-20T00:00:00Z' } });
  const worker = (settings = config()) => new AppointmentNoShowsService(appointments, visits, users, clinics, closures, days, scheduling, settings);
  const actor = () => ({ sub: f.dentist, role: 'dentist', clinics: [f.clinic] });
  const now = () => new Date('2026-10-21T01:20:00Z');
  const book = (extra = {}) => appointments.create({ ...f, services: [f.service], createdBy: f.patient,
    date: new Date('2026-10-21'), startTime: '09:00', endTime: '09:15', status: 'confirmed', history: [], ...extra });
  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_panelist_spec?replicaSet=clinica-test') throw new Error('Use isolated panelist database only.');
    db = await createConnection(uri).asPromise(); appointments = db.model(Appointment.name, AppointmentSchema); users = db.model(User.name, UserSchema);
    clinics = db.model(Clinic.name, ClinicSchema); visits = db.model(Visit.name, VisitSchema); catalog = db.model(DentalCatalog.name, DentalCatalogSchema);
    referrals = db.model(Referral.name, ReferralSchema); cases = db.model(TreatmentCase.name, TreatmentCaseSchema);
    closures = db.model(ClinicClosure.name, ClinicClosureSchema); days = db.model(DentistDayAvailability.name, DentistDayAvailabilitySchema);
    await visits.init();
  });
  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'performance', 'queueMicrotask'] });
    jest.setSystemTime(now()); await Promise.all(Object.values(db.models).map(model => model.deleteMany({})));
    const hours = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(day => ({ day, startTime: '00:00', endTime: '23:59' }));
    const clinic = await clinics.create({ name: 'No-show test clinic', operatingHours: hours });
    const dentist = await users.create({ role: 'dentist', status: 'confirmed', clinics: [clinic._id], operatingHours: hours });
    const patient = await users.create({ role: 'user', status: 'confirmed', clinics: [clinic._id] });
    const service = await catalog.create({ name: 'Short service', duration: 15 });
    f = { clinic: clinic.id, dentist: dentist.id, patient: patient.id, service: service.id };
    scheduling = new AppointmentSchedulingService(appointments, users, clinics, catalog, closures, days);
    booking = new AppointmentsService(appointments, scheduling, referrals, users, cases, visits);
    care = new VisitsService(new CareAccessService(users, appointments, visits), visits, users, clinics, appointments, cases, closures);
  });
  afterEach(() => jest.useRealTimers());
  afterAll(async () => { await db?.dropDatabase(); await db?.close(); });

  it('changes exactly at the deadline once across duplicate workers and restart, with a truthful system author', async () => {
    const appointment = await book();
    expect(await worker().applyDueNoShows(new Date('2026-10-21T01:19:59.999Z'))).toBe(0);
    const results = await Promise.all([worker().applyDueNoShows(now()), worker().applyDueNoShows(now())]);
    expect(results.reduce((a,b) => a+b, 0)).toBe(1); expect(await worker().applyDueNoShows(now())).toBe(0);
    const current = await appointments.findById(appointment._id);
    expect(current?.status).toBe('no_show'); expect(current?.history).toHaveLength(1);
    expect(current?.history[0]).toMatchObject({ actorRole: 'system', actorName: 'System' }); expect(current?.history[0].actorId).toBeUndefined();
    expect(current?.history[0].timestamp).toEqual(now());
  });
  it.each(['waiting', 'in_progress', 'completed', 'cancelled'])('preserves appointments with a %s visit', async state => {
    const appointment = await book();
    await db.collection('visits').insertOne({ appointment: appointment._id, date: '2026-10-21', state });
    expect(await worker().applyDueNoShows(now())).toBe(0);
    expect((await appointments.findById(appointment._id))?.status).toBe('confirmed');
  });
  it('skips walk-ins, disruptions, historic starts and unavailable clinic/dentist dates', async () => {
    await book({ isWalkIn: true }); await book({ disruption: { closures: [], flaggedAt: now(), message: 'Review' } });
    await book({ date: new Date('2026-10-19') });
    await book({ date: new Date('2026-10-20') });
    await days.create({ dentist: f.dentist, clinic: f.clinic, date: '2026-10-20', intervals: [] });
    await book();
    await closures.create({ clinic: f.clinic, startDate: '2026-10-21', endDate: '2026-10-21', startTime: '00:00', endTime: '24:00', reason: 'Closed', createdBy: f.dentist, createdByName: 'Doctor' });
    expect(await worker().applyDueNoShows(now())).toBe(0);
  });
  it('is disabled without both explicit activation settings', async () => {
    await book();
    expect(await worker(new ConfigService()).applyDueNoShows(now())).toBe(0);
    expect(await worker(new ConfigService({ appointmentNoShows: { enabled: true } })).applyDueNoShows(now())).toBe(0);
  });
  it('serializes check-in with the deadline so a checked-in patient is never marked absent', async () => {
    const appointment = await book();
    const results = await Promise.allSettled([
      care.checkIn(actor(), { ...f, appointment: appointment.id, purpose: 'consultation' }), worker().applyDueNoShows(now()),
    ]);
    const current = await appointments.findById(appointment._id), arrived = await visits.exists({ appointment: appointment._id });
    if (arrived) expect(current?.status).toBe('confirmed'); else expect(current?.status).toBe('no_show');
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
  });
  it('re-reads a racing reschedule and resets the deadline for the revised appointment', async () => {
    const appointment = await book();
    await Promise.allSettled([
      booking.reschedule(appointment.id, { date: new Date('2026-10-21'), startTime: '11:00', endTime: '11:30', reason: 'New time' }, actor()),
      worker().applyDueNoShows(now()),
    ]);
    const current = await appointments.findById(appointment._id);
    if (current?.startTime === '11:00') { expect(current.status).toBe('pending'); expect(current.history.some(row => row.actorRole === 'system')).toBe(false); }
    else expect(current?.status).toBe('no_show');
  });
  it('keeps cancellation after start rejected while the due outcome is applied', async () => {
    const appointment = await book();
    const [cancelled] = await Promise.allSettled([
      booking.cancel(appointment.id, { sub: f.patient, role: 'user' }, 'Late cancellation'), worker().applyDueNoShows(now()),
    ]);
    expect(cancelled.status).toBe('rejected'); expect((await appointments.findById(appointment._id))?.status).toBe('no_show');
  });
  it('handles a Manila midnight deadline and a rescheduled confirmed deadline', async () => {
    const appointment = await book({ startTime: '00:00', endTime: '00:15' });
    expect(await worker().applyDueNoShows(new Date('2026-10-20T16:20:00Z'))).toBe(1);
    await appointments.updateOne({ _id: appointment._id }, { status: 'confirmed', startTime: '11:00', endTime: '11:15' });
    expect(await worker().applyDueNoShows(now())).toBe(0);
  });
  it('advances bounded scans past arrived appointments instead of starving later bookings', async () => {
    const arrived = await appointments.insertMany(Array.from({ length: 200 }, () => ({ ...f, services: [f.service], date: new Date('2026-10-21'), startTime: '09:00', endTime: '09:15', status: 'confirmed' })));
    await db.collection('visits').insertMany(arrived.map(row => ({ appointment: row._id, date: '2026-10-21', state: 'completed' })));
    const due = await book(), scanner = worker();
    expect(await scanner.applyDueNoShows(now())).toBe(0);
    expect(await scanner.applyDueNoShows(now())).toBe(1);
    expect((await appointments.findById(due._id))?.status).toBe('no_show');
  });
});
