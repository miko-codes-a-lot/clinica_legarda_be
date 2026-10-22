import { createConnection, Connection, Model } from 'mongoose';
import { Appointment, AppointmentSchema } from './entities/appointment.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { AppointmentsService } from './appointments.service';
import { AppointmentSchedulingService } from './appointment-scheduling.service';
import { ReferralsService } from '../referral/referrals.service';
import { AppointmentStatus } from '../_shared/enum/appointment-status.enum';
import { AppointmentUpsertDto } from './dto/appointment-upsert.dto';

const uri = process.env.REFERRAL_TEST_MONGO_URI;
(uri ? describe : describe.skip)('Dentist referral scheduling boundaries', () => {
  let connection: Connection;
  let appointments: Model<Appointment>, users: Model<User>, clinics: Model<Clinic>, referrals: Model<Referral>;
  let service: AppointmentsService, referralService: ReferralsService;
  let source: string, receiver: string, patient: string, otherPatient: string, fromClinic: string, toClinic: string, referral: string;
  const hours = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => ({ day, startTime: '09:00', endTime: '17:00' }));
  const actor = () => ({ sub: source, role: 'dentist' });
  const receiverActor = () => ({ sub: receiver, role: 'dentist' });
  const dto = (): AppointmentUpsertDto => ({ patient, dentist: receiver, clinic: toClinic, referral, date: new Date('2030-10-28'), startTime: '10:00', endTime: '10:30', status: AppointmentStatus.CONFIRMED, notes: { patientNotes: 'Patient scheduling preference', clinicNotes: 'Must not enter the receiving clinical chart' } });
  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_test_referral_schedules_20261022?replicaSet=clinica-test') throw Error('Use only the owned local referral test database.');
    connection = await createConnection(uri).asPromise();
    appointments = connection.model(Appointment.name, AppointmentSchema); users = connection.model(User.name, UserSchema);
    clinics = connection.model(Clinic.name, ClinicSchema); referrals = connection.model(Referral.name, ReferralSchema);
    const catalog = connection.model(DentalCatalog.name, DentalCatalogSchema);
    service = new AppointmentsService(appointments, new AppointmentSchedulingService(appointments, users, clinics, catalog), referrals, users);
    referralService = new ReferralsService(referrals, appointments, service, users);
    await Promise.all([appointments.init(), users.init(), clinics.init(), referrals.init(), catalog.init()]);
  });
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-10-01'));
    await Promise.all([appointments.deleteMany({}), users.deleteMany({}), clinics.deleteMany({}), referrals.deleteMany({})]);
    const places = await clinics.create([{ name: 'Source', operatingHours: hours }, { name: 'Receiving', operatingHours: hours }]);
    fromClinic = places[0].id; toClinic = places[1].id;
    const people = await users.create([{ role: 'dentist', status: 'confirmed', clinics: [fromClinic], operatingHours: hours }, { role: 'dentist', status: 'confirmed', clinics: [fromClinic, toClinic], operatingHours: hours }, { role: 'user', status: 'confirmed' }, { role: 'user', status: 'confirmed' }]);
    [source, receiver, patient, otherPatient] = people.map(p => p.id);
    await appointments.create({ patient, dentist: source, clinic: fromClinic, date: new Date('2030-09-28'), startTime: '09:00', endTime: '09:30', status: 'completed' });
    referral = (await referrals.create({ patient, fromDoctorId: source, fromClinicId: fromClinic, createdBy: source, reason: 'Specialist consultation', status: 'pending' })).id;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { if (connection) { await connection.dropDatabase(); await connection.close(); } });

  it('reserves the receiving dentist with pending approval and gives the sender only referral context', async () => {
    const result = await service.create(dto(), actor());
    expect(result.status).toBe('pending');
    expect(String(result.dentist._id)).toBe(receiver);
    expect(String(result.referral?._id)).toBe(referral);
    expect(JSON.stringify(result)).not.toContain('"history"');
    expect(result.notes?.clinicNotes).toBeUndefined();
    const stored = await appointments.findById(result._id);
    expect(stored?.notes.clinicNotes).toBe('');
    await expect(service.findOne(String(result._id), actor())).rejects.toThrow('cannot access');
    await expect(service.approve(String(result._id), actor())).rejects.toThrow('cannot access');
    expect((await referralService.findOne(referral, actor())).appointment).toBeTruthy();
    await referralService.approve(referral, receiverActor());
    expect((await service.approve(String(result._id), receiverActor())).status).toBe('confirmed');
  });
  it('supports a different dentist at the same clinic through an explicit referral', async () => {
    const result = await service.create({ ...dto(), clinic: fromClinic }, actor());
    expect(result.status).toBe('pending'); expect(String(result.dentist._id)).toBe(receiver);
  });
  it('keeps ordinary appointment creation for another dentist forbidden', async () => {
    await expect(service.create({ ...dto(), referral: undefined }, actor())).rejects.toThrow('cannot access');
  });
  it.each(['createdBy', 'fromDoctorId', 'patient'] as const)('rejects a referral with mismatched %s', async key => {
    await referrals.updateOne({ _id: referral }, { $set: { [key]: key === 'patient' ? otherPatient : receiver } });
    await expect(service.create(dto(), actor())).rejects.toThrow();
    expect(await appointments.countDocuments({ dentist: receiver })).toBe(0);
  });
  it('rejects a referral without matching established source-clinic history', async () => {
    await referrals.updateOne({ _id: referral }, { $set: { fromClinicId: toClinic } });
    await expect(service.create(dto(), actor())).rejects.toThrow();
  });
  it('rechecks active source and patient identities before creating the referred booking', async () => {
    await users.updateOne({ _id: source }, { $set: { status: 'rejected' } });
    await expect(service.create(dto(), actor())).rejects.toThrow();
    await users.updateOne({ _id: source }, { $set: { status: 'confirmed' } });
    await users.updateOne({ _id: patient }, { $set: { deletedAt: new Date() } });
    await expect(service.create(dto(), actor())).rejects.toThrow();
  });
  it('rejects unavailable receiving membership, overlap and rejected referrals', async () => {
    await users.updateOne({ _id: receiver }, { $set: { clinics: [] } });
    await expect(service.create(dto(), actor())).rejects.toThrow();
    await users.updateOne({ _id: receiver }, { $set: { clinics: [toClinic] } });
    await appointments.create({ ...dto(), referral: undefined, patient: otherPatient, status: 'confirmed' });
    await expect(service.create(dto(), actor())).rejects.toThrow();
    await appointments.deleteMany({ dentist: receiver });
    await referrals.updateOne({ _id: referral }, { $set: { status: 'rejected' } });
    await expect(service.create(dto(), actor())).rejects.toThrow();
  });
  it('does not attach the source treatment case to another dentist', async () => {
    await expect(service.create({ ...dto(), careCase: '64b000000000000000000123' }, actor())).rejects.toThrow();
  });
  it('serializes competing links so a referral cannot reserve two appointments', async () => {
    const results = await Promise.allSettled([service.create(dto(), actor()), service.create({ ...dto(), startTime: '12:00', endTime: '12:30' }, actor())]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await appointments.countDocuments({ referral })).toBe(1);
  });
});
