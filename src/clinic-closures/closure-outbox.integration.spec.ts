import { ConfigService } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model } from 'mongoose';
import { Appointment } from '../appointments/entities/appointment.entity';
import { User } from '../users/entities/user.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { ClinicClosure } from './entities/clinic-closure.entity';
import { ClinicClosuresModule } from './clinic-closures.module';
import { ClinicClosuresService } from './clinic-closures.service';
import {
  AppointmentChangeEmail,
  AppointmentChangeEmailSchema,
} from '../appointment-change-emails/entities/appointment-change-email.entity';
import { AppointmentChangeEmailsService } from '../appointment-change-emails/appointment-change-emails.service';
import { AppointmentChangeSmsService } from '../appointment-change-emails/appointment-change-sms.service';
import { MailerService } from '../mailer/mailer.service';
import { SmsService } from '../sms/sms.service';

const uri = process.env.TEST_CLOSURE_OUTBOX_MONGO_URI;
if (
  uri &&
  uri !==
    'mongodb://127.0.0.1:27028/clinica_closure_outbox_spec?replicaSet=clinica-test'
)
  throw new Error('Use only the owned closure outbox database.');
(uri ? describe : describe.skip)(
  'Clinic closure transactional delivery outbox',
  () => {
    let module: TestingModule, db: Connection, service: ClinicClosuresService;
    let appointments: Model<Appointment>,
      users: Model<User>,
      clinics: Model<Clinic>,
      closures: Model<ClinicClosure>,
      notices: Model<Notification>,
      outbox: Model<AppointmentChangeEmail>;
    let id: { clinic: string; patient: string; dentist: string; admin: string };
    const emails = jest.fn<
      Promise<void>,
      Parameters<MailerService['sendAppointmentChange']>
    >();
    const sms = jest.fn<
      Promise<void>,
      Parameters<SmsService['sendAppointmentChange']>
    >();
    const emitted: unknown[] = [];
    const actor = () => ({
      sub: id.admin,
      role: 'admin',
      clinics: [id.clinic],
    });
    const dto = () => ({
      clinic: id.clinic,
      startDate: '2026-10-22',
      endDate: '2026-10-22',
      startTime: '13:00',
      endTime: '16:00',
      reason: '  Scheduled equipment maintenance  ',
    });
    const close = async () => {
      const input = dto(), preview = await service.preview(actor(), input);
      return service.create(actor(), { ...input, impactToken: preview.impactToken });
    };
    const book = (extra = {}) =>
      appointments.create({
        ...id,
        date: new Date('2026-10-22'),
        startTime: '14:00',
        endTime: '14:30',
        status: 'confirmed',
        scheduleVersion: 3,
        history: [],
        ...extra,
      });
    const deliver = async () => {
      await new AppointmentChangeEmailsService(
        outbox,
        users,
        clinics,
        { sendAppointmentChange: emails } as unknown as MailerService,
        new ConfigService(),
        appointments,
      ).sendPending();
      await new AppointmentChangeSmsService(
        outbox,
        users,
        clinics,
        { sendAppointmentChange: sms } as unknown as SmsService,
        new ConfigService(),
        appointments,
      ).sendPending();
    };
    beforeAll(async () => {
      module = await Test.createTestingModule({
        imports: [
          MongooseModule.forRoot(uri ?? ''),
          EventEmitterModule.forRoot(),
          ClinicClosuresModule,
        ],
      }).compile();
      db = module.get<Connection>(getConnectionToken());
      appointments = module.get<Model<Appointment>>(
        getModelToken(Appointment.name),
      );
      users = module.get<Model<User>>(getModelToken(User.name));
      clinics = module.get<Model<Clinic>>(getModelToken(Clinic.name));
      closures = module.get<Model<ClinicClosure>>(
        getModelToken(ClinicClosure.name),
      );
      notices = module.get<Model<Notification>>(
        getModelToken(Notification.name),
      );
      // Register independently so RED can observe missing production module/outbox wiring.
      outbox =
        (db.models[
          AppointmentChangeEmail.name
        ] as Model<AppointmentChangeEmail>) ??
        db.model(AppointmentChangeEmail.name, AppointmentChangeEmailSchema);
      service = module.get(ClinicClosuresService);
      module
        .get(EventEmitter2)
        .on('notifications.created', (value) => emitted.push(value));
      await Promise.all(Object.values(db.models).map((model) => model.init()));
    });
    beforeEach(async () => {
      jest.useFakeTimers({
        doNotFake: [
          'nextTick',
          'setImmediate',
          'clearImmediate',
          'setTimeout',
          'clearTimeout',
          'performance',
          'queueMicrotask',
        ],
      });
      jest.setSystemTime(new Date('2026-10-21T04:00:00Z'));
      await Promise.all(
        Object.values(db.models).map((model) => model.deleteMany({})),
      );
      emails.mockReset().mockResolvedValue();
      sms.mockReset().mockResolvedValue();
      emitted.length = 0;
      const c = await clinics.create({
        name: 'Owned closure outbox clinic',
        address: 'Test clinic address',
      });
      const p = await users.create({
        role: 'user',
        status: 'confirmed',
        emailAddress: 'patient@clinic-mail.ph',
        mobileNumber: '+639171234567',
      });
      const d = await users.create({
        role: 'dentist',
        status: 'confirmed',
        clinics: [c._id],
      });
      const a = await users.create({
        role: 'admin',
        username: 'Owned closure administrator',
        clinics: [c._id],
      });
      id = { clinic: c.id, patient: p.id, dentist: d.id, admin: a.id };
    });
    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });
    afterAll(async () => {
      await db?.dropDatabase();
      await module?.close();
    });

    it('production module queues one versioned disruption per affected pending/confirmed appointment', async () => {
      const confirmed = await book(),
        pending = await book({ status: 'pending', scheduleVersion: 4 });
      await book({ status: 'cancelled' });
      await book({ startTime: '17:00', endTime: '17:30' });
      const result = await close();
      const events = await outbox.find().sort({ scheduleVersion: 1 }).lean();
      expect(events).toHaveLength(2);
      expect(
        events.map((event) => ({
          eventKey: event.eventKey,
          appointment: event.appointment.toString(),
          kind: event.kind,
          scheduleVersion: event.scheduleVersion,
          reason: event.reason,
          schedule: event.schedule,
        })),
      ).toEqual(
        [confirmed, pending].map((row, index) => ({
          eventKey: `closure:${result.closure._id}:${row.id}`,
          appointment: row.id,
          kind: 'disrupted',
          scheduleVersion: index + 3,
          reason: 'Scheduled equipment maintenance',
          schedule: {
            date: '2026-10-22',
            startTime: '14:00',
            endTime: '14:30',
          },
        })),
      );
      expect(await notices.countDocuments()).toBe(4);
      expect(emitted).toHaveLength(1);
      for (const row of [confirmed, pending])
        expect(
          (await appointments.findById(row.id))?.disruption?.closures.map(
            String,
          ),
        ).toEqual([result.closure._id.toString()]);
    });
    it('delivers the committed closure snapshot independently through mocked email and SMS once', async () => {
      await book();
      await close();
      await deliver();
      await deliver();
      for (const send of [emails, sms]) expect(send).toHaveBeenCalledTimes(1);
      expect(emails).toHaveBeenCalledWith(
        'patient@clinic-mail.ph',
        expect.objectContaining({
          kind: 'disrupted',
          reason: 'Scheduled equipment maintenance',
          date: '2026-10-22',
          startTime: '14:00',
          endTime: '14:30',
        }),
      );
      expect(sms).toHaveBeenCalledWith(
        '+639171234567',
        expect.objectContaining({
          kind: 'disrupted',
          reason: 'Scheduled equipment maintenance',
        }),
      );
      expect(await outbox.findOne()).toMatchObject({
        sentAt: expect.any(Date),
        smsSentAt: expect.any(Date),
      });
    });
    it('duplicate concurrent closures cannot duplicate disruption events or in-app notices', async () => {
      await book();
      const results = await Promise.allSettled([
        close(),
        close(),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(await closures.countDocuments()).toBe(1);
      expect(await outbox.countDocuments()).toBe(1);
      expect(await notices.countDocuments()).toBe(2);
      expect(emitted).toHaveLength(1);
    });
    it('notification persistence failure rolls back closure, appointment history and queued external events', async () => {
      const appointment = await book(),
        before = await appointments.findById(appointment.id).lean();
      jest
        .spyOn(notices, 'insertMany')
        .mockRejectedValueOnce(new Error('Injected notification failure'));
      await expect(close()).rejects.toThrow(
        'Injected notification failure',
      );
      expect(await closures.countDocuments()).toBe(0);
      expect(await outbox.countDocuments()).toBe(0);
      expect(await notices.countDocuments()).toBe(0);
      expect(emitted).toHaveLength(0);
      expect(await appointments.findById(appointment.id).lean()).toEqual(
        before,
      );
    });
    it('outbox persistence failure rolls back the closure and appointment before any notice escapes', async () => {
      const appointment = await book(),
        before = await appointments.findById(appointment.id).lean();
      jest
        .spyOn(outbox, 'create')
        .mockRejectedValueOnce(new Error('Injected outbox failure'));
      await expect(close()).rejects.toThrow(
        'Injected outbox failure',
      );
      expect(await closures.countDocuments()).toBe(0);
      expect(await notices.countDocuments()).toBe(0);
      expect(await outbox.countDocuments()).toBe(0);
      expect(emitted).toHaveLength(0);
      expect(await appointments.findById(appointment.id).lean()).toEqual(
        before,
      );
    });
    it('existing workers suppress a stale closure schedule snapshot in both channels', async () => {
      const appointment = await book();
      await close();
      expect(await outbox.countDocuments()).toBe(1);
      await appointments.updateOne(
        { _id: appointment.id },
        {
          $set: { startTime: '15:00', endTime: '15:30' },
          $inc: { scheduleVersion: 1 },
        },
      );
      await deliver();
      expect(emails).not.toHaveBeenCalled();
      expect(sms).not.toHaveBeenCalled();
      expect(await outbox.findOne()).toMatchObject({
        skippedAt: expect.any(Date),
        smsSkippedAt: expect.any(Date),
      });
    });
    it('existing workers suppress recipients deleted after closure commit', async () => {
      await book();
      await close();
      expect(await outbox.countDocuments()).toBe(1);
      await users.updateOne(
        { _id: id.patient },
        { $set: { deletedAt: new Date() } },
      );
      await deliver();
      expect(emails).not.toHaveBeenCalled();
      expect(sms).not.toHaveBeenCalled();
      expect(await outbox.findOne()).toMatchObject({
        skippedAt: expect.any(Date),
        smsSkippedAt: expect.any(Date),
      });
    });
    it('hides already deleted patients from preview, affected writes, in-app notices and external events', async () => {
      const appointment = await book();
      await users.updateOne(
        { _id: id.patient },
        { $set: { deletedAt: new Date() } },
      );
      expect(await service.preview(actor(), dto())).toMatchObject({
        appointments: [],
        total: 0,
      });
      const result = await close();
      expect(result.appointments).toEqual([]);
      expect(result.closure.affectedAppointments).toHaveLength(0);
      expect(await outbox.countDocuments()).toBe(0);
      expect(await notices.countDocuments()).toBe(0);
      expect(
        (await appointments.findById(appointment.id))?.disruption,
      ).toBeUndefined();
    });
    it('retains the historical closure reference but hides a newly deleted linked patient from closure detail', async () => {
      const appointment = await book(),
        result = await close();
      await users.updateOne(
        { _id: id.patient },
        { $set: { deletedAt: new Date() } },
      );
      const detail = await service.findOne(
        actor(),
        result.closure._id.toString(),
      );
      expect(detail.closure.affectedAppointments.map(String)).toEqual([
        appointment.id,
      ]);
      expect(detail.appointments).toEqual([]);
    });
    it('does not clear disruption on a deleted patient retained record', async () => {
      const appointment = await book(),
        result = await close();
      await service.reopen(
        actor(),
        result.closure._id.toString(),
        'Equipment repaired',
      );
      await users.updateOne(
        { _id: id.patient },
        { $set: { deletedAt: new Date() } },
      );
      const before = await appointments.findById(appointment.id).lean();
      await expect(
        service.clearDisruption(
          actor(),
          appointment.id,
          'Appointment may proceed',
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await appointments.findById(appointment.id).lean()).toEqual(
        before,
      );
    });
    it('does not enqueue another notice on reopening or explicit disruption resolution', async () => {
      const appointment = await book(),
        result = await close();
      await service.reopen(
        actor(),
        result.closure._id.toString(),
        'Equipment repaired',
      );
      await service.clearDisruption(
        actor(),
        appointment.id,
        'Original appointment may proceed',
      );
      expect(await outbox.countDocuments()).toBe(1);
      expect(await notices.countDocuments()).toBe(2);
    });
    it('retains legacy direct service fixtures with the optional outbox omitted', async () => {
      await book();
      const legacy = new ClinicClosuresService(
        closures,
        clinics,
        appointments,
        users,
        notices,
        module.get(EventEmitter2),
      );
      const result = await legacy.create(actor(), { ...dto(), impactToken: (await legacy.preview(actor(), dto())).impactToken });
      expect(result.appointments).toHaveLength(1);
      expect(await notices.countDocuments()).toBe(2);
      expect(await outbox.countDocuments()).toBe(0);
    });
  },
);
