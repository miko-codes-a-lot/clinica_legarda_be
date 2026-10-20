import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { Appointment } from '../src/appointments/entities/appointment.entity';
import { AppointmentChangeEmail } from '../src/appointment-change-emails/entities/appointment-change-email.entity';
import { Clinic } from '../src/clinics/entities/clinic.entity';
import { User } from '../src/users/entities/user.entity';
import { createApp, futureClinicDay, manilaSoon, MONGO_HOST, pause, REPLICA_SET, sentTexts } from './support/sms-e2e';
import { Model } from 'mongoose';

jest.mock('axios');
jest.mock('googleapis', () => ({ google: {
  auth: { OAuth2: class { setCredentials() {} } },
  gmail: () => ({ users: { messages: { send: jest.fn() } } }),
} }));

const DATABASE = 'clinica_sms_e2e_off';
const uri = process.env.TEST_SMS_E2E_OFF_MONGO_URI;
(uri ? describe : describe.skip)('Appointment text notifications left switched off (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let outbox: Model<AppointmentChangeEmail>;

  beforeAll(async () => {
    if (uri !== `${MONGO_HOST}/${DATABASE}?${REPLICA_SET}`) throw new Error('Use the isolated text-notification e2e database only.');
    const created = await createApp(DATABASE, false);
    app = created.app;
    outbox = created.model<AppointmentChangeEmail>(AppointmentChangeEmail.name);
    const [users, clinics, appointments] = [created.model<User>(User.name), created.model<Clinic>(Clinic.name), created.model<Appointment>(Appointment.name)];
    await Promise.all([users.deleteMany({}), clinics.deleteMany({}), appointments.deleteMany({}), outbox.deleteMany({})]);
    const hours = ['monday', 'tuesday'].map(day => ({ day, startTime: '09:00', endTime: '16:00' }));
    const clinic = await clinics.create({ name: 'E2E Clinic', address: '1 Test Street', operatingHours: hours });
    const dentist = await users.create({ role: 'dentist', status: 'confirmed', username: 'e2e-dentist', clinics: [clinic._id], operatingHours: hours });
    const waiting = await users.create({ role: 'user', status: 'confirmed', mobileNumber: '+639171111111' });
    const soon = await users.create({ role: 'user', status: 'confirmed', mobileNumber: '+639174444444' });
    const pending = await appointments.create({ clinic: clinic._id, patient: waiting._id, dentist: dentist._id,
      date: new Date(futureClinicDay()), startTime: '09:00', endTime: '09:30', status: 'pending' });
    await appointments.create({ clinic: clinic._id, patient: soon._id, dentist: dentist._id, status: 'confirmed', ...manilaSoon(3) });
    await app.init();
    const cookie = `jwt=${await app.get(JwtService).signAsync({ sub: dentist.id, username: 'e2e-dentist', role: 'dentist' })}`;
    await request(app.getHttpServer()).patch(`/api/appointments/${pending.id}/approve`).set('Cookie', cookie).expect(200);
  });
  afterAll(async () => { await app?.close(); });

  it('sends no text, for a due reminder or an approval, unless APPOINTMENT_SMS_ENABLED is set', async () => {
    await pause(18_000); // longer than the 15-second change scan, after the reminder scan that runs at startup
    expect(sentTexts()).toEqual([]);
    expect(await outbox.countDocuments({ kind: 'confirmed' })).toBe(1); // the approval was queued, just not texted
    expect(await outbox.countDocuments({ smsSentAt: { $exists: true } })).toBe(0);
    expect(await outbox.countDocuments({ smsSkippedAt: { $exists: true } })).toBe(0);
  });
});
