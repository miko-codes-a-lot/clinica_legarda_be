import { ConfigService } from '@nestjs/config';
import { Connection, createConnection, Model } from 'mongoose';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { AppointmentSmsRemindersService } from './appointment-sms-reminders.service';
import { AppointmentReminder, AppointmentReminderSchema } from './entities/appointment-reminder.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { MailerService } from '../mailer/mailer.service';
import { SmsService } from '../sms/sms.service';

const uri = process.env.TEST_REMINDER_SMS_MONGO_URI;
(uri ? describe : describe.skip)('Scheduled appointment reminder texts', () => {
  let connection: Connection;
  let appointments: Model<Appointment>;
  let reminders: Model<AppointmentReminder>;
  let users: Model<User>;
  let clinics: Model<Clinic>;
  let service: AppointmentSmsRemindersService;
  const send = jest.fn<Promise<void>, Parameters<SmsService['sendAppointmentReminder']>>();
  const sendEmail = jest.fn<Promise<void>, Parameters<MailerService['sendAppointmentReminder']>>();
  let fixture: { clinic: string; patient: string; dentist: string };
  const createService = () => new AppointmentSmsRemindersService(appointments, reminders,
    { sendAppointmentReminder: send } as unknown as SmsService, new ConfigService());
  const createEmailService = () => new AppointmentRemindersService(appointments, reminders,
    { sendAppointmentReminder: sendEmail } as unknown as MailerService, new ConfigService());
  const book = (extra: Record<string, unknown> = {}) => appointments.create({
    ...fixture, date: new Date('2026-10-10'), startTime: '09:30', endTime: '10:00', status: 'confirmed', ...extra,
  });

  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_reminder_sms_spec?replicaSet=clinica-test') throw new Error('Use only isolated reminder text test database.');
    connection = await createConnection(uri).asPromise();
    appointments = connection.model(Appointment.name, AppointmentSchema);
    reminders = connection.model(AppointmentReminder.name, AppointmentReminderSchema);
    users = connection.model(User.name, UserSchema);
    clinics = connection.model(Clinic.name, ClinicSchema);
    await reminders.init();
  });
  beforeEach(async () => {
    await Promise.all([appointments.deleteMany({}), reminders.deleteMany({}), users.deleteMany({}), clinics.deleteMany({})]);
    // Leave Mongo's network timers real; control only the domain clock.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'performance', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-10-09T01:30:00Z')); // October 9, 9:30 AM Manila
    send.mockReset().mockResolvedValue(undefined);
    sendEmail.mockReset().mockResolvedValue(undefined);
    const clinic = await clinics.create({ name: 'Test Clinic', address: 'Test Address' });
    const patient = await users.create({ role: 'user', emailAddress: 'patient@clinic-mail.ph', mobileNumber: '+639171234567' });
    const dentist = await users.create({ role: 'dentist' });
    fixture = { clinic: clinic.id, patient: patient.id, dentist: dentist.id };
    service = createService();
  });
  afterEach(() => jest.useRealTimers());
  afterAll(async () => { await connection?.dropDatabase(); await connection?.close(); });

  it('texts at the 24-hour Manila boundary and only once across concurrent workers and restarts', async () => {
    await book();
    await Promise.all([service.sendDueReminders(), createService().sendDueReminders()]);
    await createService().sendDueReminders();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('+639171234567', {
      clinicName: 'Test Clinic', clinicAddress: 'Test Address', date: '2026-10-10', startTime: '09:30', endTime: '10:00',
      arrivalDeadline: new Date('2026-10-10T01:50:00Z'),
    });
    expect(await reminders.countDocuments({ sentAt: { $exists: true } })).toBe(1);
  });

  it('texts a patient with no usable email, and reminds by email and text independently', async () => {
    await book();
    await Promise.all([createEmailService().sendDueReminders(), service.sendDueReminders()]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await reminders.countDocuments({ sentAt: { $exists: true } })).toBe(2);

    await reminders.deleteMany({});
    send.mockClear(); sendEmail.mockClear();
    await users.updateOne({ _id: fixture.patient }, { $unset: { emailAddress: 1 } });
    await Promise.all([createEmailService().sendDueReminders(), service.sendDueReminders()]);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not send early, and catches up an unsent appointment within 24 hours', async () => {
    await book({ startTime: '09:31' });
    await service.sendDueReminders();
    expect(send).not.toHaveBeenCalled();
    jest.setSystemTime(new Date('2026-10-09T02:00:00Z'));
    await service.sendDueReminders();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('skips cancelled, rejected, pending, completed, past and disrupted appointments', async () => {
    for (const status of ['cancelled', 'rejected', 'pending', 'completed', 'no_show']) await book({ status });
    await book({ date: new Date('2026-10-09') }); // starting now, no longer future
    await book({ disruption: { closures: [], flaggedAt: new Date(), message: 'Closed' } });
    await service.sendDueReminders();
    expect(send).not.toHaveBeenCalled();
    expect(await reminders.countDocuments()).toBe(0);
  });

  it.each([undefined, '12345', '+639171234567,+639181234567'])('creates no claim and sends nothing when the mobile number is %p', async (mobileNumber) => {
    await users.collection.updateOne({ _id: new (await import('mongoose')).Types.ObjectId(fixture.patient) },
      mobileNumber === undefined ? { $unset: { mobileNumber: 1 } } : { $set: { mobileNumber } });
    await book();
    await service.sendDueReminders();
    expect(send).not.toHaveBeenCalled();
    expect(await reminders.countDocuments()).toBe(0);
  });

  it('texts the verified parent of a dependent and names the child', async () => {
    const parent = await users.create({ role: 'user', status: 'confirmed', otpVerifiedAt: new Date(), emailAddress: 'parent@clinic-mail.ph', mobileNumber: '+639181234567' });
    const child = await users.create({ role: 'user', isDependent: true, guardian: parent._id, firstName: 'Alice', lastName: 'Child', mobileNumber: '+639170000000' });
    await book({ patient: child._id });
    await service.sendDueReminders();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('+639181234567', expect.objectContaining({ patientName: 'Alice Child' }));
  });

  it('recovers an abandoned claim after its lease expires', async () => {
    await book();
    const original = reminders.findOneAndUpdate.bind(reminders);
    const claim = jest.spyOn(reminders, 'findOneAndUpdate').mockImplementationOnce((...args) => {
      const query = original(...args);
      const execute = query.exec.bind(query);
      query.exec = async () => { await execute(); throw new Error('Worker stopped after claim'); };
      return query;
    });
    await expect(service.sendDueReminders()).rejects.toThrow('Worker stopped after claim');
    claim.mockRestore();
    await createService().sendDueReminders();
    expect(send).not.toHaveBeenCalled();
    jest.setSystemTime(new Date('2026-10-09T01:35:00Z'));
    await createService().sendDueReminders();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('defers a failed delivery then retries and records success', async () => {
    await book();
    send.mockRejectedValueOnce(new Error('Simulated provider failure'));
    await service.sendDueReminders();
    await service.sendDueReminders();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await reminders.countDocuments({ sentAt: { $exists: true } })).toBe(0);
    jest.setSystemTime(new Date('2026-10-09T01:40:00Z'));
    await service.sendDueReminders();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await reminders.countDocuments({ sentAt: { $exists: true } })).toBe(1);
  });

  it('reminds again for a new schedule, while cancellation prevents its delivery', async () => {
    const appointment = await book();
    await service.sendDueReminders();
    await appointments.updateOne({ _id: appointment._id }, { $set: { startTime: '11:00', endTime: '11:30' } });
    await service.sendDueReminders();
    expect(send).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date('2026-10-09T03:00:00Z'));
    await service.sendDueReminders();
    expect(send).toHaveBeenCalledTimes(2);
    await appointments.updateOne({ _id: appointment._id }, { $set: { startTime: '12:00', endTime: '12:30', status: 'cancelled' } });
    jest.setSystemTime(new Date('2026-10-09T04:00:00Z'));
    await service.sendDueReminders();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rechecks cancellation between the scan and delivery claim', async () => {
    const appointment = await book();
    const original = reminders.findOneAndUpdate.bind(reminders);
    const claim = jest.spyOn(reminders, 'findOneAndUpdate').mockImplementationOnce((...args) => {
      const query = original(...args);
      const execute = query.exec.bind(query);
      query.exec = async () => {
        const result = await execute();
        await appointments.updateOne({ _id: appointment._id }, { status: 'cancelled' });
        return result;
      };
      return query;
    });
    await service.sendDueReminders();
    claim.mockRestore();
    expect(send).not.toHaveBeenCalled();
    expect(await reminders.countDocuments({ sentAt: { $exists: true } })).toBe(0);
  });
});
