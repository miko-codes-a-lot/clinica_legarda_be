import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { clinicReferenceId } from '../users/clinic-membership';
import { BadRequestException } from '@nestjs/common';
import { Connection, createConnection, Model } from 'mongoose';
import { Appointment, AppointmentSchema } from './entities/appointment.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { AppointmentSchedulingService } from './appointment-scheduling.service';
import { AppointmentsService } from './appointments.service';

const uri = process.env.TEST_MONGO_URI;
const localTests = uri ? describe : describe.skip;

localTests('Appointment scheduling persistence', () => {
  let connection: Connection;
  let competingConnection: Connection;
  let competingService: AppointmentsService;
  let appointments: Model<Appointment>;
  let users: Model<User>;
  let clinics: Model<Clinic>;
  let catalog: Model<DentalCatalog>;
  let service: AppointmentsService;
  let fixture: { dentist: string; patient: string; otherPatient: string; clinic: string; otherClinic: string };
  const actor = { sub: '64b000000000000000000099', role: 'super-admin' };
  const hours = [{ day: 'monday', startTime: '08:00', endTime: '18:00' }];
  const date = new Date('2026-09-21T00:00:00.000Z');

  beforeAll(async () => {
    if (!uri || !/^mongodb:\/\/127\.0\.0\.1:27028\/clinica_test_ticket05\?replicaSet=clinica-test$/.test(uri)) {
      throw new Error('Use only the isolated local clinica_test_ticket05 database.');
    }
    connection = await createConnection(uri).asPromise();
    appointments = connection.model(Appointment.name, AppointmentSchema);
    users = connection.model(User.name, UserSchema);
    clinics = connection.model(Clinic.name, ClinicSchema);
    catalog = connection.model(DentalCatalog.name, DentalCatalogSchema);
    await appointments.init();
    await users.init();
    await clinics.init();
    service = new AppointmentsService(appointments, new AppointmentSchedulingService(appointments, users, clinics, catalog), connection.model(Referral.name, ReferralSchema), users);
    competingConnection = await createConnection(uri).asPromise();
    const otherAppointments = competingConnection.model(Appointment.name, AppointmentSchema);
    competingService = new AppointmentsService(otherAppointments, new AppointmentSchedulingService(
      otherAppointments, competingConnection.model(User.name, UserSchema),
      competingConnection.model(Clinic.name, ClinicSchema), competingConnection.model(DentalCatalog.name, DentalCatalogSchema),
    ), competingConnection.model(Referral.name, ReferralSchema), competingConnection.model<User>(User.name));
  });
  beforeEach(async () => {
    await appointments.deleteMany({});
    await users.deleteMany({});
    await clinics.deleteMany({});
    await catalog.deleteMany({});
    const places = await clinics.create([
      { name: 'Fixture A', operatingHours: hours },
      { name: 'Fixture B', operatingHours: hours },
    ]);
    const dentist = await users.create({ role: 'dentist', status: 'confirmed', clinics: places.map(c => c._id), operatingHours: hours });
    const patients = await users.create([{ role: 'user' }, { role: 'user' }]);
    fixture = { dentist: dentist.id, patient: patients[0].id, otherPatient: patients[1].id, clinic: places[0].id, otherClinic: places[1].id };
  });
  afterAll(async () => { await connection?.close(); await competingConnection?.close(); });

  it.each(['09:00', '09:30'])('allows only one competing cross-clinic approval at %s', async secondStart => {
    const requests = await appointments.create([
      { ...fixture, date, startTime: '09:00', endTime: '10:00', status: 'pending' },
      { ...fixture, patient: fixture.otherPatient, clinic: fixture.otherClinic, date, startTime: secondStart, endTime: secondStart === '09:00' ? '10:00' : '10:30', status: 'pending' },
    ]);
    const results = await Promise.allSettled([service.approve(requests[0].id, actor), competingService.approve(requests[1].id, actor)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(r => r.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason).toBeInstanceOf(BadRequestException);
    expect(await appointments.countDocuments({ status: 'confirmed' })).toBe(1);
    expect(await appointments.countDocuments({ status: 'pending' })).toBe(1);
  });

  it('returns only occupied slot fields across clinics, without patient details', async () => {
    await appointments.create([
      { ...fixture, date, startTime: '09:00', endTime: '10:00', status: 'pending', notes: { patientNotes: 'Private fixture note' } },
      { ...fixture, clinic: fixture.otherClinic, date, startTime: '11:00', endTime: '12:00', status: 'confirmed' },
      { ...fixture, date, startTime: '13:00', endTime: '14:00', status: 'cancelled' },
    ]);
    const slots = await service.availability(fixture.dentist, actor);
    expect(slots).toHaveLength(2);
    for (const slot of slots) expect(Object.keys(slot).sort()).toEqual(['_id', 'date', 'endTime', 'startTime', 'status']);
  });

  it('reschedules with stored identities, excludes itself, and preserves history', async () => {
    const current = await appointments.create({ ...fixture, date, startTime: '09:00', endTime: '10:00', status: 'confirmed', history: [{ action: 'Existing history' }] });
    const result = await service.reschedule(current.id, {
      date, startTime: '09:00', endTime: '10:00', patient: fixture.otherPatient,
      dentist: fixture.otherPatient, reason: '  Correct calendar  ',
    }, actor);
    expect(result.patient._id.toString()).toBe(fixture.patient);
    expect(result.dentist._id.toString()).toBe(fixture.dentist);
    expect(result.status).toBe('pending');
    expect(result.history).toHaveLength(2);
    expect(result.history[1].reason).toBe('Correct calendar');
  });

  it('rejects same calendar-day conflicts and revoked membership on new writes', async () => {
    await appointments.create({ ...fixture, date: new Date('2026-09-21T12:00:00Z'), startTime: '09:00', endTime: '10:00', status: 'confirmed' });
    const dto = { ...fixture, clinic: fixture.otherClinic, patient: fixture.otherPatient, date, startTime: '09:30', endTime: '10:30', referral: '' };
    await expect(service.create(dto, actor)).rejects.toThrow('Dentist already');
    await users.updateOne({ _id: fixture.dentist }, { $set: { clinics: [] } });
    await expect(service.create({ ...dto, startTime: '11:00', endTime: '12:00' }, actor)).rejects.toThrow('not assigned');
  });

  it('serializes simultaneous creates for a patient across different dentists', async () => {
    const other = await users.create({ role: 'dentist', status: 'confirmed', clinics: [fixture.clinic], operatingHours: hours });
    const dto = { clinic: fixture.clinic, patient: fixture.patient, dentist: fixture.dentist, date, startTime: '09:00', endTime: '10:00', referral: undefined };
    const results = await Promise.allSettled([
      service.create(dto, actor), competingService.create({ ...dto, dentist: other.id, startTime: '09:30', endTime: '10:30' }, actor),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await appointments.countDocuments()).toBe(1);
  });

  it('updates to another assigned clinic and preserves profile update timestamps when locking', async () => {
    const before = await users.findById(fixture.dentist).lean();
    const current = await appointments.create({ ...fixture, date, startTime: '09:00', endTime: '10:00' });
    const result = await service.update(current.id, {
      clinic: fixture.otherClinic, patient: fixture.patient, dentist: fixture.dentist,
      date, startTime: '09:00', endTime: '10:00', referral: undefined,
    }, actor);
    expect(clinicReferenceId(result.clinic)).toBe(fixture.otherClinic);
    const after = await users.findById(fixture.dentist).lean();
    expect(after?.['updatedAt']).toEqual(before?.['updatedAt']);
    expect(after).not.toHaveProperty('scheduleRevision');
  });


  it('uses selected service duration and books normal requests at both assigned clinics', async () => {
    const treatment = await catalog.create({ name: 'Fixture treatment', duration: 90 });
    const dto = { clinic: fixture.clinic, dentist: fixture.dentist, patient: fixture.patient,
      date, startTime: '09:00', endTime: '10:00', services: [treatment.id] };
    await expect(service.create(dto, actor)).rejects.toThrow('cover the selected services');
    await expect(service.create({ ...dto, endTime: '10:30' }, actor)).resolves.toMatchObject({ status: 'pending' });
    await expect(service.create({ ...dto, clinic: fixture.otherClinic, startTime: '10:45', endTime: '12:15' }, actor)).resolves.toMatchObject({ status: 'pending' });
    expect(await appointments.countDocuments()).toBe(2);
  });

  it.each(['dentist', 'patient'])('cannot bypass occupied slots with an uppercase %s ID', async identity => {
    await appointments.create({ ...fixture, date, startTime: '09:00', endTime: '10:00', status: 'confirmed' });
    const otherDentist = await users.create({ role: 'dentist', status: 'confirmed', clinics: [fixture.clinic], operatingHours: hours });
    const dto = {
      clinic: fixture.clinic, date, startTime: '09:30', endTime: '10:30',
      dentist: identity === 'dentist' ? fixture.dentist.toUpperCase() : otherDentist.id,
      patient: identity === 'patient' ? fixture.patient.toUpperCase() : fixture.otherPatient,
    };
    await expect(service.create(dto, actor)).rejects.toThrow(identity === 'dentist' ? 'Dentist already' : 'Patient already');
    expect(await appointments.countDocuments()).toBe(1);
  });

  it('counts existing daily capacity for an uppercase dentist ID', async () => {
    await appointments.create({ ...fixture, date, startTime: '09:00', endTime: '10:00', status: 'confirmed' });
    await users.updateOne({ _id: fixture.dentist }, { $set: { maxWorkingMinutesPerDay: 100 } });
    await expect(service.create({
      clinic: fixture.clinic, dentist: fixture.dentist.toUpperCase(), patient: fixture.otherPatient,
      date, startTime: '11:00', endTime: '12:00',
    }, actor)).rejects.toThrow('remaining working time');
  });

  it('accepts equivalent uppercase clinic, participant, and service IDs for an available slot', async () => {
    const treatment = await catalog.create({ name: 'Fixture uppercase reference', duration: 60 });
    await expect(service.create({
      clinic: fixture.clinic.toUpperCase(), dentist: fixture.dentist.toUpperCase(), patient: fixture.patient.toUpperCase(),
      services: [treatment.id.toUpperCase()], date, startTime: '09:00', endTime: '10:00',
    }, actor)).resolves.toMatchObject({ status: 'pending' });
  });

  it.each(['create', 'update'])('stores one service when %s receives ObjectId casing aliases', async operation => {
    const treatment = await catalog.create({ name: 'Fixture aliased treatment', duration: 60 });
    const dto = { clinic: fixture.clinic, dentist: fixture.dentist, patient: fixture.patient,
      date, startTime: '09:00', endTime: '10:00', services: [treatment.id, treatment.id.toUpperCase()] };
    const current = operation === 'update' ? await appointments.create({ ...dto, services: [] }) : undefined;
    const result = current ? await service.update(current.id, dto, actor) : await service.create(dto, actor);
    const saved = await appointments.findById(result._id.toString()).lean();
    expect(saved?.services.map(clinicReferenceId)).toEqual([treatment.id]);
  });

});
