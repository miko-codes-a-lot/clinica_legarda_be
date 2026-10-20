import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createConnection, Connection, Model } from 'mongoose';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentSchedulingService } from './appointment-scheduling.service';
import { Appointment, AppointmentSchema } from './entities/appointment.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import {
  DentalCatalog,
  DentalCatalogSchema,
} from '../dental-catalog/entities/dental-catalog.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import {
  AppointmentChangeEmail,
  AppointmentChangeEmailSchema,
} from '../appointment-change-emails/entities/appointment-change-email.entity';
import { AppointmentChangeEmailsService } from '../appointment-change-emails/appointment-change-emails.service';
import { AppointmentChangeSmsService } from '../appointment-change-emails/appointment-change-sms.service';
import { MailerService } from '../mailer/mailer.service';
import { SmsService } from '../sms/sms.service';

const uri = process.env.TEST_RESCHEDULE_MONGO_URI;
(uri ? describe : describe.skip)(
  'Patient agreement to clinic-proposed schedules',
  () => {
    let db: Connection, app: INestApplication;
    let service: AppointmentsService;
    let appointments: Model<Appointment>,
      users: Model<User>,
      clinics: Model<Clinic>,
      catalog: Model<DentalCatalog>,
      outbox: Model<AppointmentChangeEmail>;
    let id: Record<
      'patient' | 'other' | 'dentist' | 'clinic' | 'service' | 'appointment',
      string
    >;
    const email = jest.fn<
      Promise<void>,
      Parameters<MailerService['sendAppointmentChange']>
    >();
    const sms = jest.fn<
      Promise<void>,
      Parameters<SmsService['sendAppointmentChange']>
    >();
    const emailWorker = () =>
      new AppointmentChangeEmailsService(
        outbox,
        users,
        clinics,
        { sendAppointmentChange: email } as unknown as MailerService,
        new ConfigService(),
        appointments,
      );
    const smsWorker = () =>
      new AppointmentChangeSmsService(
        outbox,
        users,
        clinics,
        { sendAppointmentChange: sms } as unknown as SmsService,
        new ConfigService(),
        appointments,
      );
    const patch = (action: string, actor: string, body: object = {}) =>
      request(app.getHttpServer())
        .patch(`/appointments/${id.appointment}/${action}`)
        .set('Cookie', `jwt=${actor}`)
        .send(body);
    const offer = {
      date: '2026-10-26',
      startTime: '11:00',
      endTime: '11:30',
      reason: 'Dentist availability changed',
    };
    const propose = () => patch('reschedule', 'dentist', offer).expect(200);
    const response = (
      proposalId: string,
      actor = 'patient',
      extra: object = {},
    ) =>
      patch('reschedule-response', actor, {
        proposalId,
        method: 'patient_portal',
        ...extra,
      });
    const proposalId = (body: { rescheduleProposal?: { id: string } }) =>
      body.rescheduleProposal?.id ?? '10000000-0000-4000-8000-000000000000';
    beforeAll(async () => {
      if (
        uri !==
        'mongodb://127.0.0.1:27028/clinica_reschedule_response_spec?replicaSet=clinica-test'
      )
        throw new Error('Use only the isolated reschedule response database.');
      db = await createConnection(uri).asPromise();
      appointments = db.model(Appointment.name, AppointmentSchema);
      users = db.model(User.name, UserSchema);
      clinics = db.model(Clinic.name, ClinicSchema);
      catalog = db.model(DentalCatalog.name, DentalCatalogSchema);
      outbox = db.model(
        AppointmentChangeEmail.name,
        AppointmentChangeEmailSchema,
      );
      const referrals = db.model(Referral.name, ReferralSchema);
      await outbox.init();
      service = new AppointmentsService(
        appointments,
        new AppointmentSchedulingService(appointments, users, clinics, catalog),
        referrals,
        users,
        undefined,
        undefined,
        outbox,
      );
      const module = await Test.createTestingModule({
        controllers: [AppointmentsController],
        providers: [
          { provide: AppointmentsService, useValue: service },
          {
            provide: AuthService,
            useValue: {
              resolveActor: async (actor: unknown) => actor,
              verifyJwt: async (token: string) => ({
                sub:
                  token === 'dentist'
                    ? id.dentist
                    : ['other', 'parent'].includes(token)
                      ? id.other
                      : id.patient,
                role: token === 'dentist' ? 'dentist' : 'user',
                ...(token === 'parent' ? { patientIds: [id.patient] } : {}),
                username: token,
              }),
            },
          },
          { provide: APP_GUARD, useClass: AuthGuard },
        ],
      }).compile();
      app = module.createNestApplication();
      app.use(cookieParser());
      app.useGlobalPipes(new ValidationPipe());
      await app.init();
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
      jest.setSystemTime(new Date('2026-10-20T00:00:00Z'));
      await Promise.all([
        appointments.deleteMany({}),
        users.deleteMany({}),
        clinics.deleteMany({}),
        catalog.deleteMany({}),
        outbox.deleteMany({}),
      ]);
      email.mockReset().mockResolvedValue();
      sms.mockReset().mockResolvedValue();
      const hours = ['monday', 'tuesday'].map((day) => ({
        day,
        startTime: '09:00',
        endTime: '18:00',
      }));
      const clinic = await clinics.create({
        name: 'Agreement test clinic',
        operatingHours: hours,
      });
      const patient = await users.create({
        role: 'user',
        status: 'confirmed',
        emailAddress: 'patient@clinic-mail.ph',
        mobileNumber: '+639171234567',
      });
      const other = await users.create({ role: 'user', status: 'confirmed' });
      const dentist = await users.create({
        role: 'dentist',
        status: 'confirmed',
        clinics: [clinic._id],
        operatingHours: hours,
      });
      const treatment = await catalog.create({
        name: 'Test service',
        duration: 30,
        clinics: [clinic._id],
      });
      const appointment = await appointments.create({
        patient: patient._id,
        dentist: dentist._id,
        clinic: clinic._id,
        services: [treatment._id],
        createdBy: dentist._id,
        date: new Date('2026-10-26'),
        startTime: '09:00',
        endTime: '09:30',
        status: 'confirmed',
        history: [],
      });
      id = {
        patient: patient.id,
        other: other.id,
        dentist: dentist.id,
        clinic: clinic.id,
        service: treatment.id,
        appointment: appointment.id,
      };
    });
    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });
    afterAll(async () => {
      await app?.close();
      await db?.dropDatabase();
      await db?.close();
    });

    it('asks the patient to respond and prevents staff from approving their own proposal', async () => {
      const { body } = await propose();
      expect(body).toMatchObject({
        status: 'pending',
        rescheduleProposal: {
          reason: offer.reason,
          previousSchedule: {
            date: '2026-10-26',
            startTime: '09:00',
            endTime: '09:30',
          },
        },
      });
      await patch('approve', 'dentist').expect(409);
      await emailWorker().sendPending();
      await smsWorker().sendPending();
      for (const send of [email, sms])
        expect(send).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            kind: 'rescheduled',
            responseRequired: true,
          }),
        );
    });
    it('confirms the patient acceptance once without a second staff approval', async () => {
      const { body } = await propose();
      await response(proposalId(body))
        .expect(200)
        .expect(({ body }) => {
          expect(body.status).toBe('confirmed');
          expect(body.rescheduleProposal).toBeUndefined();
        });
      await response(proposalId(body)).expect(409);
      await Promise.all([
        emailWorker().sendPending(),
        smsWorker().sendPending(),
      ]);
      await emailWorker().sendPending();
      await smsWorker().sendPending();
      for (const send of [email, sms]) {
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            kind: 'confirmed',
            reason: offer.reason,
            previousSchedule: {
              date: '2026-10-26',
              startTime: '09:00',
              endTime: '09:30',
            },
            arrivalDeadline: new Date('2026-10-26T03:20:00Z'),
          }),
        );
      }
    });
    it('rejects an unrelated patient and stale proposal responses', async () => {
      const { body } = await propose();
      await response(proposalId(body), 'other').expect(403);
      const newer = await patch('reschedule', 'dentist', {
        ...offer,
        startTime: '12:00',
        endTime: '12:30',
        proposalId: proposalId(body),
      }).expect(200);
      expect(proposalId(newer.body)).not.toBe(proposalId(body));
      await response(proposalId(body)).expect(409);
      await response(proposalId(newer.body)).expect(200);
    });
    it('lets the patient request another time and returns approval to the clinic', async () => {
      const { body } = await propose();
      await patch('reschedule', 'patient', {
        ...offer,
        startTime: '12:00',
        endTime: '12:30',
        reason: 'I cannot attend that time',
        proposalId: proposalId(body),
      })
        .expect(200)
        .expect(({ body }) => {
          expect(body.status).toBe('pending');
          expect(body.rescheduleProposal).toBeUndefined();
        });
      await patch('approve', 'patient').expect(403);
      await patch('approve', 'dentist').expect(200);
      await emailWorker().sendPending();
      await smsWorker().sendPending();
      for (const send of [email, sms]) {
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][1].kind).toBe('confirmed');
      }
    });
    it('lets a patient cancel a clinic-created proposal without inheriting creator-only restrictions', async () => {
      const { body } = await propose();
      await patch('cancel', 'patient', {
        reason: 'I cannot attend',
        proposalId: proposalId(body),
      }).expect(200);
      await emailWorker().sendPending();
      await smsWorker().sendPending();
      for (const send of [email, sms]) {
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][1].kind).toBe('cancelled');
      }
    });
    it('requires recorded phone/in-person agreement for staff and rejects a fabricated portal acceptance', async () => {
      const { body } = await propose();
      await response(proposalId(body), 'dentist').expect(403);
      await response(proposalId(body), 'dentist', { method: 'phone' }).expect(
        400,
      );
      await response(proposalId(body), 'dentist', {
        method: 'phone',
        reason: 'Patient agreed over the phone',
      })
        .expect(200)
        .expect(({ body }) =>
          expect(body.history.at(-1)).toMatchObject({
            actorRole: 'dentist',
            reason: 'Patient agreed over the phone',
          }),
        );
    });
    it('does not accept an unanswered time after it starts or send a stale proposal prompt', async () => {
      const { body } = await propose();
      jest.setSystemTime(new Date('2026-10-26T03:00:01Z'));
      await response(proposalId(body)).expect(409);
      await emailWorker().sendPending();
      await smsWorker().sendPending();
      expect(email).not.toHaveBeenCalled();
      expect(sms).not.toHaveBeenCalled();
      expect((await appointments.findById(id.appointment))?.status).toBe(
        'pending',
      );
    });
    it('automatically cancels an unanswered proposal once with an expiry reason and no No-show', async () => {
      await propose();
      jest.setSystemTime(new Date('2026-10-26T03:00:01Z'));
      const expiry = service as unknown as {
        expireRescheduleProposals(now: Date): Promise<number>;
      };
      expect(await expiry.expireRescheduleProposals(new Date())).toBe(1);
      expect(await expiry.expireRescheduleProposals(new Date())).toBe(0);
      expect((await appointments.findById(id.appointment))?.status).toBe(
        'cancelled',
      );
      await emailWorker().sendPending();
      await smsWorker().sendPending();
      for (const send of [email, sms]) {
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][1]).toMatchObject({
          kind: 'cancelled',
          reason: expect.stringContaining('no response'),
        });
      }
    });
    it('uses the verified parent for agreement and both delivery channels, naming the child', async () => {
      await users.updateOne(
        { _id: id.other },
        {
          $set: {
            otpVerifiedAt: new Date(),
            emailAddress: 'parent@clinic-mail.ph',
            mobileNumber: '+639181234567',
          },
        },
      );
      await users.updateOne(
        { _id: id.patient },
        {
          $set: {
            isDependent: true,
            loginEnabled: false,
            guardian: id.other,
            firstName: 'Alice',
            lastName: 'Child',
          },
        },
      );
      const { body } = await propose();
      await response(proposalId(body), 'parent').expect(200);
      await emailWorker().sendPending();
      await smsWorker().sendPending();
      expect(email).toHaveBeenCalledWith(
        'parent@clinic-mail.ph',
        expect.objectContaining({
          kind: 'confirmed',
          patientName: 'Alice Child',
        }),
      );
      expect(sms).toHaveBeenCalledWith(
        '+639181234567',
        expect.objectContaining({
          kind: 'confirmed',
          patientName: 'Alice Child',
        }),
      );
    });
    it('rechecks guardian membership even when a stale session still claims the child', async () => {
      await users.updateOne(
        { _id: id.other },
        { $set: { otpVerifiedAt: new Date() } },
      );
      await users.updateOne(
        { _id: id.patient },
        {
          $set: { isDependent: true, loginEnabled: false, guardian: id.other },
        },
      );
      const { body } = await propose();
      await users.updateOne({ _id: id.patient }, { $unset: { guardian: 1 } });
      await response(proposalId(body), 'parent').expect(403);
    });
    it('serializes competing accept/cancel responses and sends only the committed final result', async () => {
      const { body } = await propose();
      const results = await Promise.all([
        response(proposalId(body)),
        patch('cancel', 'patient', {
          proposalId: proposalId(body),
          reason: 'Cannot attend',
        }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      await emailWorker().sendPending();
      await smsWorker().sendPending();
      expect(email).toHaveBeenCalledTimes(1);
      expect(sms).toHaveBeenCalledTimes(1);
    });
    it('revalidates current clinic hours before recording patient agreement', async () => {
      const { body } = await propose();
      await clinics.updateOne(
        { _id: id.clinic },
        { $set: { operatingHours: [] } },
      );
      await response(proposalId(body)).expect(400);
      expect((await appointments.findById(id.appointment))?.status).toBe(
        'pending',
      );
    });
    it('never sends a prior-version confirmation when a schedule returns to the same clock time', async () => {
      await appointments.collection.updateOne(
        { _id: (await appointments.findById(id.appointment))!._id },
        { $set: { scheduleVersion: 2 } },
      );
      await outbox.collection.insertOne({
        appointment: (await appointments.findById(id.appointment))!._id,
        patient: (await users.findById(id.patient))!._id,
        clinic: (await clinics.findById(id.clinic))!._id,
        kind: 'confirmed',
        schedule: { date: '2026-10-26', startTime: '09:00', endTime: '09:30' },
        scheduleVersion: 0,
        createdAt: new Date(),
      });
      await emailWorker().sendPending();
      await smsWorker().sendPending();
      expect(email).not.toHaveBeenCalled();
      expect(sms).not.toHaveBeenCalled();
    });
    it('blocks service changes during an unanswered proposal but permits patient notes', async () => {
      const { body } = await propose();
      const extra = await catalog.create({
        name: 'Different service',
        duration: 30,
        clinics: [id.clinic],
      });
      const details = {
        patient: id.patient,
        dentist: id.dentist,
        clinic: id.clinic,
        date: offer.date,
        startTime: offer.startTime,
        endTime: offer.endTime,
      };
      await request(app.getHttpServer())
        .put(`/appointments/${id.appointment}`)
        .set('Cookie', 'jwt=patient')
        .send({ ...details, services: [extra.id] })
        .expect(409);
      await request(app.getHttpServer())
        .put(`/appointments/${id.appointment}`)
        .set('Cookie', 'jwt=patient')
        .send({
          ...details,
          services: [id.service.toUpperCase()],
        notes: { patientNotes: 'Please call before the visit' },
        })
        .expect(200);
      await response(proposalId(body)).expect(200);
      expect(
        (await appointments.findById(id.appointment))?.services.map(String),
      ).toEqual([id.service]);
    });
    it('does not prompt acceptance of a proposal disrupted by changed availability', async () => {
      await propose();
      await appointments.updateOne(
        { _id: id.appointment },
        {
          $set: {
            disruption: { reason: 'Clinic closed', detectedAt: new Date() },
          },
        },
      );
      await emailWorker().sendPending();
      await smsWorker().sendPending();
      expect(email).not.toHaveBeenCalled();
      expect(sms).not.toHaveBeenCalled();
    });
    it.each([
      { method: 'patient_portal' },
      { proposalId: 'invalid', method: 'patient_portal' },
      { proposalId: '10000000-0000-4000-8000-000000000000', method: 'pretend' },
    ])('validates response identity and method (%j)', async (body) => {
      await patch('reschedule-response', 'patient', body).expect(400);
    });
  },
);
