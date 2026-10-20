import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { Types } from 'mongoose';
import { Appointment } from '../src/appointments/entities/appointment.entity';
import { Clinic } from '../src/clinics/entities/clinic.entity';
import { User } from '../src/users/entities/user.entity';
import { createApp, eventually, futureClinicDay, manilaSoon, MONGO_HOST, REPLICA_SET, sentTexts } from './support/sms-e2e';

jest.mock('axios');
const mockGmailSend = jest.fn();
jest.mock('googleapis', () => ({ google: {
  auth: { OAuth2: class { setCredentials() {} } },
  gmail: () => ({ users: { messages: { send: mockGmailSend } } }),
} }));

const DATABASE = 'clinica_sms_e2e';
const uri = process.env.TEST_SMS_E2E_MONGO_URI;
(uri ? describe : describe.skip)('Appointment text notifications (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let id: Record<'confirmable' | 'rejectable' | 'cancellable' | 'reminder' | 'login' | 'dentist', string>;
  let cookie: string;
  const server = () => app.getHttpServer();
  const textsTo = (number: string) => sentTexts().filter(text => text.number === number);

  beforeAll(async () => {
    if (uri !== `${MONGO_HOST}/${DATABASE}?${REPLICA_SET}`) throw new Error('Use the isolated text-notification e2e database only.');
    const created = await createApp(DATABASE, true);
    app = created.app;
    const [users, clinics, appointments] = [created.model<User>(User.name), created.model<Clinic>(Clinic.name), created.model<Appointment>(Appointment.name)];
    await Promise.all([users.deleteMany({}), clinics.deleteMany({}), appointments.deleteMany({})]);

    const hours = ['monday', 'tuesday'].map(day => ({ day, startTime: '09:00', endTime: '16:00' }));
    const clinic = await clinics.create({ name: 'E2E Clinic', address: '1 Test Street', operatingHours: hours });
    const dentist = await users.create({ role: 'dentist', status: 'confirmed', username: 'e2e-dentist', clinics: [clinic._id], operatingHours: hours });
    const patient = (mobileNumber: string, extra: Record<string, unknown> = {}) =>
      users.create({ role: 'user', status: 'confirmed', mobileNumber, ...extra });
    const confirmable = await patient('+639171111111', { emailAddress: 'confirmable@clinic-mail.ph' });
    const rejectable = await patient('+639172222222'); // no email address at all
    const cancellable = await patient('+639173333333', { emailAddress: 'cancellable@clinic-mail.ph' });
    const reminder = await patient('+639174444444', { emailAddress: 'reminder@clinic-mail.ph' });
    const login = await patient('+639175555555', { username: 'e2e-login', password: await bcrypt.hash('E2e-Passw0rd!', 4), emailAddress: 'login@clinic-mail.ph' });

    const day = new Date(futureClinicDay());
    const book = (who: { _id: unknown }, startTime: string, endTime: string, status: string, extra: Record<string, unknown> = {}) =>
      appointments.create({ clinic: clinic._id, patient: who._id, dentist: dentist._id, date: day, startTime, endTime, status, ...extra });
    const toApprove = await book(confirmable, '09:00', '09:30', 'pending');
    const toReject = await book(rejectable, '10:00', '10:30', 'pending');
    const toCancel = await book(cancellable, '11:00', '11:30', 'confirmed');
    await book(reminder, '00:00', '00:00', 'confirmed', manilaSoon(3));
    id = { confirmable: toApprove.id, rejectable: toReject.id, cancellable: toCancel.id, reminder: reminder.id, login: login.id, dentist: dentist.id };

    await app.init();
    cookie = `jwt=${await app.get(JwtService).signAsync({ sub: dentist.id, username: 'e2e-dentist', role: 'dentist' })}`;
  });
  afterAll(async () => { await app?.close(); });

  it('texts a patient their reminder when the application starts, with no email flag set', async () => {
    await eventually(() => expect(textsTo('639174444444')).toHaveLength(1), 40_000);
    const [text] = textsTo('639174444444');
    expect(text).toMatchObject({ sendername: 'E2ECLINIC', apikey: 'e2e-key' });
    expect(text.message).toContain('R. Nañez Dental Clinic\nYour upcoming dental appointment');
    expect(text.message).toContain('Clinic: E2E Clinic');
    expect(text.message).toContain('No-show');
    expect(mockGmailSend).not.toHaveBeenCalled();
  });

  it('texts the patient when staff approve, reject and cancel appointments through the API', async () => {
    const as = (method: 'patch', path: string) => request(server())[method](path).set('Cookie', cookie);
    await as('patch', `/api/appointments/${id.confirmable}/approve`).expect(200);
    await as('patch', `/api/appointments/${id.rejectable}/reject`).send({ reason: 'Dentist unavailable' }).expect(200);
    await as('patch', `/api/appointments/${id.cancellable}/cancel`).send({ reason: 'Clinic closed that day' }).expect(200);

    await eventually(() => {
      expect(textsTo('639171111111')).toHaveLength(1);
      expect(textsTo('639172222222')).toHaveLength(1);
      expect(textsTo('639173333333')).toHaveLength(1);
    }, 40_000);

    const [confirmed] = textsTo('639171111111');
    expect(confirmed.message).toContain('Your appointment is confirmed');
    expect(confirmed.message).toContain('Clinic: E2E Clinic');
    expect(confirmed.message).toContain('Address: 1 Test Street');
    expect(confirmed.message).toContain('9:00 AM - 9:30 AM (Philippine time)');
    expect(confirmed.message).toContain('Please check in by');
    // The patient with no email address at all is still told.
    expect(textsTo('639172222222')[0].message).toContain('Your appointment request was declined');
    expect(textsTo('639172222222')[0].message).toContain('Reason: Dentist unavailable');
    expect(textsTo('639173333333')[0].message).toContain('Your appointment was cancelled');
    expect(textsTo('639173333333')[0].message).toContain('Reason: Clinic closed that day');
    expect(mockGmailSend).not.toHaveBeenCalled();
  });

  it('does not text the same change again on later scans', async () => {
    const before = sentTexts().length;
    await new Promise(resolve => setTimeout(resolve, 17_000)); // longer than the 15-second scan interval
    expect(sentTexts().length).toBe(before);
  });

  it('keeps the login code to email only', async () => {
    const response = await request(server()).post('/api/auth/sign-in').send({ username: 'e2e-login', password: 'E2e-Passw0rd!' }).expect(200);
    expect(response.body.otpRequired).toBe(true);
    expect(mockGmailSend).toHaveBeenCalledTimes(1);
    const raw = Buffer.from((mockGmailSend.mock.calls[0][0] as { requestBody: { raw: string } }).requestBody.raw, 'base64url').toString('utf8');
    expect(raw).toContain('To: login@clinic-mail.ph');
    expect(textsTo('639175555555')).toEqual([]);
    expect((axios.post as jest.Mock).mock.calls.every(([url]) => url === 'https://api.semaphore.co/api/v4/messages')).toBe(true);
  });

  it('ignores an id that is not an appointment without texting anyone', async () => {
    const before = sentTexts().length;
    await request(server()).patch(`/api/appointments/${new Types.ObjectId().toHexString()}/approve`).set('Cookie', cookie).expect(404);
    expect(sentTexts().length).toBe(before);
  });
});
