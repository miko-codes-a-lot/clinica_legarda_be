import { sendViaSemaphore } from '../auth/sms.helper';
jest.mock('../auth/sms.helper', () => ({
  ...jest.requireActual('../auth/sms.helper'),
  sendViaSemaphore: jest.fn().mockResolvedValue(undefined),
}));
import { VisitsService } from '../care/visits.service';
import { TreatmentCasesService } from '../care/treatment-cases.service';
import { ReferralsService } from '../referral/referrals.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  Notification,
  NotificationSchema,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  ClientSession,
  Connection,
  createConnection,
  Model,
  Types,
} from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/entities/appointment.entity';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { User, UserSchema } from './entities/user.entity';
import { UserStatus } from '../_shared/enum/user-status.enum';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import {
  DentalCatalog,
  DentalCatalogSchema,
} from '../dental-catalog/entities/dental-catalog.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import {
  TreatmentCase,
  TreatmentCaseSchema,
} from '../care/entities/treatment-case.entity';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { OtpService } from '../otp/otp.service';
import { MailerService } from '../mailer/mailer.service';
import {
  AppointmentChangeEmail,
  AppointmentChangeEmailSchema,
} from '../appointment-change-emails/entities/appointment-change-email.entity';
import { AppointmentChangeEmailsService } from '../appointment-change-emails/appointment-change-emails.service';
import { AppointmentChangeSmsService } from '../appointment-change-emails/appointment-change-sms.service';
import { SmsService } from '../sms/sms.service';
import { CareAccessService } from '../care/care-access.service';
import { PatientRecordsService } from '../care/patient-records.service';
import { findPatientRecipient } from './patient-recipient';
import { UserActor } from '../auth/role-policy';

const uri = process.env.TEST_SOFT_DELETE_MONGO_URI;
(uri ? describe : describe.skip)(
  'Patient soft deletion and appointment retention',
  () => {
    let db: Connection,
      users: Model<User>,
      appointments: Model<Appointment>,
      clinics: Model<Clinic>,
      visits: Model<Visit>,
      cases: Model<TreatmentCase>,
      catalog: Model<DentalCatalog>,
      referrals: Model<Referral>,
      outbox: Model<AppointmentChangeEmail>;
    let notices: Model<Notification>;
    let people: UsersService,
      booking: AppointmentsService,
      access: CareAccessService,
      records: PatientRecordsService,
      auth: AuthService;
    let f: {
      clinic: string;
      otherClinic: string;
      patient: string;
      dentist: string;
      service: string;
      admin: UserActor;
      superAdmin: UserActor;
      patientActor: UserActor;
      dentistActor: UserActor;
    };
    const sendEmail = jest.fn(),
      sendSms = jest.fn(),
      sendOtp = jest.fn();
    const future = {
      date: new Date('2026-10-26'),
      startTime: '09:00',
      endTime: '09:30',
    };
    beforeAll(async () => {
      if (
        uri !==
        'mongodb://127.0.0.1:27028/clinica_patient_soft_delete_spec?replicaSet=clinica-test'
      )
        throw Error('Use only the isolated patient soft delete database');
      db = await createConnection(uri).asPromise();
      users = db.model(User.name, UserSchema);
      appointments = db.model(Appointment.name, AppointmentSchema);
      clinics = db.model(Clinic.name, ClinicSchema);
      visits = db.model(Visit.name, VisitSchema);
      cases = db.model(TreatmentCase.name, TreatmentCaseSchema);
      catalog = db.model(DentalCatalog.name, DentalCatalogSchema);
      referrals = db.model(Referral.name, ReferralSchema);
      outbox = db.model(
        AppointmentChangeEmail.name,
        AppointmentChangeEmailSchema,
      );
      notices = db.model(Notification.name, NotificationSchema);
      await outbox.init();
      people = new UsersService(users, clinics, appointments, visits);
      booking = new AppointmentsService(
        appointments,
        new AppointmentSchedulingService(appointments, users, clinics, catalog),
        referrals,
        users,
        cases,
        visits,
        outbox,
      );
      access = new CareAccessService(users, appointments, visits);
      records = new PatientRecordsService(
        access,
        users,
        appointments,
        visits,
        cases,
        clinics,
      );
      auth = new AuthService(
        { signAsync: async () => 'test-session' } as unknown as JwtService,
        people,
        { generate: async () => '123456' } as unknown as OtpService,
        {
          ensureSendingAvailable: () => undefined,
          sendOtp,
        } as unknown as MailerService,
      );
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
      jest.setSystemTime(new Date('2026-10-21T00:00:00Z'));
      await Promise.all(
        Object.values(db.models).map((model) => model.deleteMany({})),
      );
      sendEmail.mockReset().mockResolvedValue(undefined);
      sendSms.mockReset().mockResolvedValue(undefined);
      sendOtp.mockReset().mockResolvedValue(undefined);
      jest.mocked(sendViaSemaphore).mockClear();
      const hours = [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ].map((day) => ({ day, startTime: '08:00', endTime: '18:00' }));
      const [clinic, otherClinic] = await clinics.create([
        { name: 'Soft deletion clinic', operatingHours: hours },
        { name: 'Other clinic', operatingHours: hours },
      ]);
      const patient = await users.create({
        firstName: 'Retained',
        lastName: 'Patient',
        username: 'retained.patient',
        emailAddress: 'retained@clinic-mail.ph',
        mobileNumber: '+639171234567',
        role: 'user',
        status: 'confirmed',
        clinics: [clinic._id],
        otpVerifiedAt: new Date(),
      });
      const dentist = await users.create({
        firstName: 'Treating',
        lastName: 'Dentist',
        role: 'dentist',
        status: 'confirmed',
        clinics: [clinic._id],
        operatingHours: hours,
      });
      const service = await catalog.create({
        name: 'Consultation',
        duration: 30,
        clinics: [clinic._id],
      });
      f = {
        clinic: clinic.id,
        otherClinic: otherClinic.id,
        patient: patient.id,
        dentist: dentist.id,
        service: service.id,
        admin: {
          sub: new Types.ObjectId().toString(),
          role: 'admin',
          clinics: [clinic.id],
        },
        superAdmin: {
          sub: new Types.ObjectId().toString(),
          role: 'super-admin',
        },
        patientActor: { sub: patient.id, role: 'user' },
        dentistActor: {
          sub: dentist.id,
          role: 'dentist',
          clinics: [clinic.id],
        },
      };
    });
    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });
    afterAll(async () => {
      await db?.dropDatabase();
      await db?.close();
    });
    const book = () =>
      booking.create(
        {
          ...future,
          patient: f.patient,
          dentist: f.dentist,
          clinic: f.clinic,
          services: [f.service],
        },
        f.patientActor,
      );
    const confirmed = async () => {
      const a = await book();
      return booking.approve(String(a._id), f.dentistActor);
    };
    it.each(['admin', 'superAdmin'] as const)(
      'retains the patient identity and cancels reservations atomically for %s',
      async (role) => {
        const pending = await book();
        const reserved = await appointments.create({
          ...future,
          date: new Date('2026-10-27'),
          patient: f.patient,
          dentist: f.dentist,
          clinic: f.clinic,
          services: [f.service],
          createdBy: f.patient,
          status: 'confirmed',
          history: [],
        });
        await people.delete(f.patient, f[role]);
        const stored = await users.collection.findOne({
          _id: new Types.ObjectId(f.patient),
        });
        expect(stored).toMatchObject({
          firstName: 'Retained',
          lastName: 'Patient',
          loginEnabled: false,
          deletedAt: expect.any(Date),
          deletedBy: new Types.ObjectId(f[role].sub),
        });
        const retained = await appointments.find({
          _id: { $in: [pending._id, reserved._id] },
        });
        expect(retained).toHaveLength(2);
        for (const row of retained) {
          expect(row.status).toBe('cancelled');
          expect(row.history.at(-1)).toMatchObject({
            actorId: f[role].sub,
            reason: expect.stringContaining('deleted'),
          });
          expect(row.createdBy?.toString()).toBe(f.patient);
        }
        expect(await booking.findAll(f.superAdmin)).toHaveLength(0);
        const historical = await booking.findOne(
          String(pending._id),
          f.superAdmin,
        );
        expect(historical.patient).toMatchObject({
          firstName: 'Retained',
          deletedAt: expect.any(Date),
        });
      },
    );
    it('hides deleted accounts from directories and care search without removing retained history', async () => {
      const a = await confirmed();
      await visits.create({
        patient: f.patient,
        dentist: f.dentist,
        clinic: f.clinic,
        appointment: a._id,
        date: '2026-10-20',
        checkedInAt: new Date('2026-10-20'),
        state: 'completed',
        purpose: 'consultation',
        createdBy: f.dentist,
        summary: 'Retained clinical summary',
      });
      await people.delete(f.patient, f.superAdmin);
      expect(await visits.countDocuments({ patient: f.patient })).toBe(1);
      expect(await people.findAll(f.superAdmin)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ _id: new Types.ObjectId(f.patient) }),
        ]),
      );
      expect(await people.patientDirectory(f.superAdmin)).toHaveLength(0);
      expect((await records.search(f.superAdmin, { page: 1 })).total).toBe(0);
      expect(await people.findOne(f.patient, f.superAdmin)).toMatchObject({
        deletedAt: expect.any(Date),
      });
    });
    it('rejects stale login/session and password reset lookup after deletion', async () => {
      await people.delete(f.patient, f.superAdmin);
      expect(await people.findForSignIn('retained.patient')).toBeNull();
      expect(await people.findForAuthentication(f.patient)).toBeNull();
      expect(
        await people.findForResetOtp('retained@clinic-mail.ph'),
      ).toBeNull();
      await expect(auth.resolveActor(f.patientActor)).rejects.toThrow();
      expect(sendOtp).not.toHaveBeenCalled();
    });
    it('does not resurrect the account through an ordinary profile edit', async () => {
      await people.delete(f.patient, f.superAdmin);
      await expect(
        people.upsert(
          { firstName: 'Restored' } as never,
          f.patient,
          f.superAdmin,
        ),
      ).rejects.toThrow(/deleted|read.only/i);
    });
    it('releases the held slot and rejects booking for the deleted patient', async () => {
      await confirmed();
      await people.delete(f.patient, f.superAdmin);
      await expect(book()).rejects.toThrow();
      expect(await booking.availability(f.dentist, f.superAdmin)).toHaveLength(
        0,
      );
      const replacement = await users.create({
        role: 'user',
        status: 'confirmed',
        clinics: [f.clinic],
      });
      await expect(
        booking.create(
          {
            ...future,
            patient: replacement.id,
            dentist: f.dentist,
            clinic: f.clinic,
            services: [f.service],
          },
          f.superAdmin,
        ),
      ).resolves.toBeTruthy();
    });
    it('invalidates a proposal and suppresses both queued notification channels', async () => {
      const a = await confirmed();
      await booking.reschedule(
        String(a._id),
        {
          date: new Date('2026-10-26'),
          startTime: '11:00',
          endTime: '11:30',
          reason: 'Clinic proposed another time',
        },
        f.dentistActor,
      );
      await people.delete(f.patient, f.superAdmin);
      const retained = await appointments.findById(a._id);
      expect(retained?.status).toBe('cancelled');
      expect(retained?.rescheduleProposal).toBeUndefined();
      expect(await findPatientRecipient(users, f.patient)).toBeNull();
      await new AppointmentChangeEmailsService(
        outbox,
        users,
        clinics,
        { sendAppointmentChange: sendEmail } as unknown as MailerService,
        new ConfigService(),
        appointments,
      ).sendPending();
      await new AppointmentChangeSmsService(
        outbox,
        users,
        clinics,
        { sendAppointmentChange: sendSms } as unknown as SmsService,
        new ConfigService(),
        appointments,
      ).sendPending();
      expect(sendEmail).not.toHaveBeenCalled();
      expect(sendSms).not.toHaveBeenCalled();
    });
    it('rejects deletion during active care without cancelling the appointment', async () => {
      const a = await confirmed();
      await visits.create({
        patient: f.patient,
        dentist: f.dentist,
        clinic: f.clinic,
        appointment: a._id,
        date: '2026-10-26',
        checkedInAt: new Date(),
        state: 'waiting',
        purpose: 'consultation',
        createdBy: f.dentist,
      });
      await expect(people.delete(f.patient, f.superAdmin)).rejects.toThrow(
        /active|checked.in|queue/i,
      );
      expect((await appointments.findById(a._id))?.status).toBe('confirmed');
      expect(
        (await users.collection.findOne({ _id: new Types.ObjectId(f.patient) }))
          ?.deletedAt,
      ).toBeUndefined();
    });
    it('preserves child access rules and revokes a deleted child from its parent', async () => {
      const parent = await users.create({
        role: 'user',
        status: UserStatus.CONFIRMED,
        otpVerifiedAt: new Date(),
      });
      await users.updateOne(
        { _id: f.patient },
        {
          $set: {
            isDependent: true,
            loginEnabled: false,
            guardian: parent._id,
          },
        },
      );
      await book();
      await expect(people.delete(parent.id, f.superAdmin)).rejects.toThrow(
        /child|relationship/i,
      );
      await people.delete(f.patient, f.superAdmin);
      expect(await people.managedPatientIds(parent)).toEqual([parent.id]);
    });
    it('hides linked referral, visit, case, notification and analytics lists while keeping direct history', async () => {
      const a = await confirmed();
      const referral = await referrals.create({
        patient: f.patient,
        fromDoctorId: f.dentist,
        fromClinicId: f.clinic,
        reason: 'Retained referral',
      });
      await appointments.updateOne(
        { _id: a._id },
        { $set: { referral: referral._id } },
      );
      const visit = await visits.create({
        patient: f.patient,
        dentist: f.dentist,
        clinic: f.clinic,
        appointment: a._id,
        date: '2026-10-26',
        checkedInAt: new Date(),
        state: 'completed',
        purpose: 'consultation',
        createdBy: f.dentist,
      });
      const careCase = await cases.create({
        patient: f.patient,
        dentist: f.dentist,
        clinic: f.clinic,
        consultationVisit: visit._id,
        title: 'Retained case',
        plan: 'Retained care plan',
        createdBy: f.dentist,
      });
      await notices.create({
        recipient: f.superAdmin.sub,
        appointment: a._id,
        type: NotificationType.APPOINTMENT_STATUS_UPDATED,
        message: 'Retained appointment notice',
      });
      const caseService = new TreatmentCasesService(
          access,
          cases,
          visits,
          appointments,
          users,
          clinics,
        ),
        visitService = new VisitsService(
          access,
          visits,
          users,
          clinics,
          appointments,
          cases,
        ),
        referralService = new ReferralsService(
          referrals,
          appointments,
          booking,
          users,
        ),
        notificationService = new NotificationsService(
          notices,
          new EventEmitter2(),
          appointments,
          users,
        ),
        analytics = new AnalyticsService(
          appointments,
          referrals,
          undefined,
          users,
        );
      jest.setSystemTime(new Date('2026-10-26T00:00:00Z'));
      expect(await referralService.findAll(f.superAdmin)).toHaveLength(1);
      expect(await caseService.list(f.superAdmin, {})).toHaveLength(1);
      expect(await visitService.list(f.superAdmin, {})).toHaveLength(1);
      expect(
        await notificationService.findAllForUser(f.superAdmin),
      ).toHaveLength(1);
      expect(
        (await analytics.getWeeklySummary('all', f.superAdmin))
          .totalAppointments,
      ).toBe(1);
      await people.delete(f.patient, f.superAdmin);
      expect(await referralService.findAll(f.superAdmin)).toHaveLength(0);
      expect(await caseService.list(f.superAdmin, {})).toHaveLength(0);
      expect(await visitService.list(f.superAdmin, {})).toHaveLength(0);
      expect(
        await notificationService.findAllForUser(f.superAdmin),
      ).toHaveLength(0);
      expect(
        (await analytics.getWeeklySummary('all', f.superAdmin))
          .totalAppointments,
      ).toBe(0);
      expect(
        (await caseService.findOne(f.superAdmin, careCase.id)).careCase
          ?.patient,
      ).toMatchObject({ firstName: 'Retained', deletedAt: expect.any(Date) });
      expect(
        (await visitService.findOne(f.superAdmin, visit.id))?.patient,
      ).toMatchObject({ deletedAt: expect.any(Date) });
      expect(
        (await records.report(f.superAdmin, f.patient)).record.patient,
      ).toMatchObject({ deletedAt: expect.any(Date) });
      await expect(
        caseService.close(f.superAdmin, careCase.id, {
          revision: 0,
          status: 'discontinued',
        }),
      ).rejects.toThrow(/deleted|read.only/i);
      await expect(
        referralService.approve(referral.id, f.superAdmin),
      ).rejects.toThrow(/deleted|read.only/i);
    });
    it('rolls back the tombstone if cancelling linked reservations fails', async () => {
      const a = await confirmed();
      jest
        .spyOn(appointments, 'updateMany')
        .mockRejectedValueOnce(new Error('Injected reservation write failure'));
      await expect(people.delete(f.patient, f.superAdmin)).rejects.toThrow(
        'Injected reservation write failure',
      );
      expect((await users.findById(f.patient))?.deletedAt).toBeUndefined();
      expect((await appointments.findById(a._id))?.status).toBe('confirmed');
    });
    it('serializes a racing deletion and booking without leaving an active reservation', async () => {
      const result = await Promise.allSettled([
        book(),
        people.delete(f.patient, f.superAdmin),
      ]);
      expect(result[1].status).toBe('fulfilled');
      expect((await users.findById(f.patient))?.deletedAt).toBeInstanceOf(Date);
      expect(
        await appointments.countDocuments({
          patient: f.patient,
          status: { $in: ['pending', 'confirmed'] },
        }),
      ).toBe(0);
    });
    it('rechecks shared-clinic authorization after taking the deletion lock', async () => {
      await book();
      const policy = people as unknown as {
        hasOutsideClinicAccess(
          user: User,
          actor: UserActor,
          session?: ClientSession,
        ): Promise<boolean>;
      };
      jest
        .spyOn(policy, 'hasOutsideClinicAccess')
        .mockImplementationOnce(async () => {
          await users.updateOne(
            { _id: f.patient },
            { $set: { clinics: [f.clinic, f.otherClinic] } },
          );
          return false;
        });
      await expect(people.delete(f.patient, f.admin)).rejects.toThrow(
        /super|outside|clinic/i,
      );
      expect((await users.findById(f.patient))?.deletedAt).toBeUndefined();
      expect(
        await appointments.countDocuments({
          patient: f.patient,
          status: 'pending',
        }),
      ).toBe(1);
    });
    it.each(['generate', 'verify', 'password'] as const)(
      'rejects a stale password-reset %s write after deletion',
      async (phase) => {
        await users.updateOne(
          { _id: f.patient },
          {
            $set: {
              resetOtp: '123456',
              resetOtpExpires: new Date(Date.now() + 300000),
              resetOtpVerified: true,
            },
          },
        );
        const load = people.findForResetOtp.bind(people);
        jest
          .spyOn(people, 'findForResetOtp')
          .mockImplementationOnce((email: string) => {
            const query = load(email);
            query.post(async () => {
              await people.delete(f.patient, f.superAdmin);
            });
            return query;
          });
        if (phase === 'generate')
          await auth.generateResetOtp('retained@clinic-mail.ph');
        else if (phase === 'verify')
          await expect(
            auth.verifyResetOtp('retained@clinic-mail.ph', '123456'),
          ).rejects.toThrow();
        else
          await expect(
            auth.resetPasswordWithOtp(
              'retained@clinic-mail.ph',
              'NewPassword123!',
            ),
          ).rejects.toThrow();
        const stored = await users
          .findById(f.patient)
          .select('+password +resetOtp +resetOtpExpires +resetOtpVerified');
        expect(stored?.deletedAt).toBeInstanceOf(Date);
        expect(stored?.resetOtp).toBeUndefined();
        expect(stored?.resetOtpVerified).toBe(false);
        expect(stored?.password).toBeUndefined();
        expect(sendViaSemaphore).not.toHaveBeenCalled();
      },
    );
    it.each(['create', 'edit', 'approve', 'reject'] as const)(
      'rejects a stale referral %s write when deletion wins the participant lock',
      async (phase) => {
        await book();
        const referral = await referrals.create({
          patient: f.patient,
          fromDoctorId: f.dentist,
          fromClinicId: f.clinic,
          reason: 'Original referral',
        });
        const service = new ReferralsService(
            referrals,
            appointments,
            booking,
            users,
          ),
          exists = users.exists.bind(users);
        jest.spyOn(users, 'exists').mockImplementationOnce((filter) => {
          const query = exists(filter);
          query.post(async () => {
            await people.delete(f.patient, f.superAdmin);
          });
          return query;
        });
        const dto = {
          patient: f.patient,
          fromDoctorId: f.dentist,
          fromClinicId: f.clinic,
          reason: 'Revised referral',
        };
        const result =
          phase === 'create'
            ? service.upsert(dto, undefined, f.superAdmin)
            : phase === 'edit'
              ? service.upsert(dto, referral.id, f.superAdmin)
              : phase === 'approve'
                ? service.approve(referral.id, f.superAdmin)
                : service.reject('Cannot continue', referral.id, f.superAdmin);
        await expect(result).rejects.toThrow(/deleted|read.only/i);
        expect(await referrals.countDocuments()).toBe(1);
        expect(await referrals.findById(referral._id)).toMatchObject({
          reason: 'Original referral',
          status: 'pending',
        });
      },
    );
    it('keeps the normal reset flow usable and consumes the verified code only once', async () => {
      await auth.generateResetOtp('retained@clinic-mail.ph');
      expect(sendViaSemaphore).toHaveBeenCalledTimes(1);
      const issued = await users.findById(f.patient).select('+resetOtp');
      expect(issued?.resetOtp).toMatch(/^\d{6}$/);
      if (!issued?.resetOtp)
        throw new Error('Fixture did not issue a reset code');
      await auth.verifyResetOtp('retained@clinic-mail.ph', issued.resetOtp);
      await auth.resetPasswordWithOtp(
        'retained@clinic-mail.ph',
        'NewPassword123!',
      );
      const stored = await users
        .findById(f.patient)
        .select('+password +resetOtp +resetOtpVerified');
      expect(stored?.password).toMatch(/^\$2/);
      expect(stored?.resetOtp).toBeUndefined();
      expect(stored?.resetOtpVerified).toBe(false);
      await expect(
        auth.resetPasswordWithOtp(
          'retained@clinic-mail.ph',
          'AnotherPassword123!',
        ),
      ).rejects.toThrow();
    });
    it('does not hide an orphaned legacy reservation while still letting it occupy a slot', async () => {
      await appointments.create({
        ...future,
        patient: new Types.ObjectId(),
        dentist: f.dentist,
        clinic: f.clinic,
        services: [f.service],
        status: 'confirmed',
      });
      expect(await booking.availability(f.dentist, f.superAdmin)).toHaveLength(
        0,
      );
      await expect(book()).resolves.toBeTruthy();
    });
    it('does not permit an unrelated clinic administrator to delete the patient', async () => {
      await book();
      await expect(
        people.delete(f.patient, { ...f.admin, clinics: [f.otherClinic] }),
      ).rejects.toThrow();
      expect(await users.findById(f.patient)).toBeTruthy();
      expect(await booking.findAll(f.superAdmin)).toHaveLength(1);
    });
  },
);
