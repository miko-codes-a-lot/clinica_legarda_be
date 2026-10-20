import { createConnection, Connection, Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
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
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import {
  TreatmentCase,
  TreatmentCaseSchema,
} from '../care/entities/treatment-case.entity';
import {
  ClinicClosure,
  ClinicClosureSchema,
} from '../clinic-closures/entities/clinic-closure.entity';
import {
  DentistDayAvailability,
  DentistDayAvailabilitySchema,
} from '../dentist-availability/entities/dentist-day-availability.entity';
import {
  AppointmentChangeEmail,
  AppointmentChangeEmailSchema,
} from '../appointment-change-emails/entities/appointment-change-email.entity';
import { AppointmentNoShowsService } from '../appointment-no-shows/appointment-no-shows.service';
import { CareAccessService } from '../care/care-access.service';
import { VisitsService } from '../care/visits.service';

const uri = process.env.TEST_FLOW_TRANSITION_MONGO_URI;
if (
  uri &&
  uri !==
    'mongodb://127.0.0.1:27028/clinica_flow_transition_spec?replicaSet=clinica-test'
)
  throw new Error('Use only the owned flow transition database.');
(uri ? describe : describe.skip)(
  'Appointment transition and current schedule attendance',
  () => {
    let db: Connection,
      appointments: Model<Appointment>,
      users: Model<User>,
      clinics: Model<Clinic>,
      catalog: Model<DentalCatalog>,
      referrals: Model<Referral>,
      visits: Model<Visit>,
      outbox: Model<AppointmentChangeEmail>;
    let booking: AppointmentsService,
      worker: AppointmentNoShowsService,
      care: VisitsService;
    let f: {
      patient: string;
      dentist: string;
      clinic: string;
      service: string;
    };
    const actor = () => ({
      sub: f.dentist,
      role: 'dentist',
      clinics: [f.clinic],
    });
    const patient = () => ({ sub: f.patient, role: 'user' });
    const book = (extra = {}) =>
      appointments.create({
        ...f,
        services: [f.service],
        createdBy: f.patient,
        date: new Date('2026-10-21'),
        startTime: '14:00',
        endTime: '14:30',
        status: 'confirmed',
        history: [],
        ...extra,
      });
    beforeAll(async () => {
      db = await createConnection(uri ?? '').asPromise();
      appointments = db.model(Appointment.name, AppointmentSchema);
      users = db.model(User.name, UserSchema);
      clinics = db.model(Clinic.name, ClinicSchema);
      catalog = db.model(DentalCatalog.name, DentalCatalogSchema);
      referrals = db.model(Referral.name, ReferralSchema);
      visits = db.model(Visit.name, VisitSchema);
      outbox = db.model(
        AppointmentChangeEmail.name,
        AppointmentChangeEmailSchema,
      );
      const cases = db.model(TreatmentCase.name, TreatmentCaseSchema),
        closures = db.model(ClinicClosure.name, ClinicClosureSchema),
        days = db.model(
          DentistDayAvailability.name,
          DentistDayAvailabilitySchema,
        );
      await Promise.all(Object.values(db.models).map((model) => model.init()));
      const scheduling = new AppointmentSchedulingService(
        appointments,
        users,
        clinics,
        catalog,
        closures,
        days,
      );
      booking = new AppointmentsService(
        appointments,
        scheduling,
        referrals,
        users,
        cases,
        visits,
        outbox,
      );
      worker = new AppointmentNoShowsService(
        appointments,
        visits,
        users,
        clinics,
        closures,
        days,
        scheduling,
        new ConfigService({
          appointmentNoShows: {
            enabled: true,
            enforceFrom: '2026-10-20T00:00:00Z',
          },
        }),
      );
      care = new VisitsService(
        new CareAccessService(users, appointments, visits),
        visits,
        users,
        clinics,
        appointments,
        cases,
        closures,
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
      jest.setSystemTime(new Date('2026-10-21T04:00:00Z'));
      await Promise.all(
        Object.values(db.models).map((model) => model.deleteMany({})),
      );
      const hours = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ].map((day) => ({ day, startTime: '00:00', endTime: '23:59' }));
      const clinic = await clinics.create({
        name: 'Owned transition test clinic',
        operatingHours: hours,
      });
      const p = await users.create({
        role: 'user',
        status: 'confirmed',
        clinics: [clinic._id],
      });
      const d = await users.create({
        role: 'dentist',
        status: 'confirmed',
        clinics: [clinic._id],
        operatingHours: hours,
      });
      const s = await catalog.create({
        name: 'Test consultation',
        duration: 30,
        clinics: [clinic._id],
      });
      f = { patient: p.id, dentist: d.id, clinic: clinic.id, service: s.id };
    });
    afterEach(() => jest.useRealTimers());
    afterAll(async () => {
      await db?.dropDatabase();
      await db?.close();
    });

    it('rejects manual No-show just before the original Manila arrival deadline without changing history', async () => {
      const a = await book();
      jest.setSystemTime(new Date('2026-10-21T06:19:59.999Z'));
      await expect(booking.noShow(a.id, actor())).rejects.toMatchObject({
        status: 409,
      });
      expect((await appointments.findById(a.id))?.history).toHaveLength(0);
    });
    it('allows manual No-show exactly at the deadline and does not duplicate terminal history', async () => {
      const a = await book();
      jest.setSystemTime(new Date('2026-10-21T06:20:00Z'));
      expect((await booking.noShow(a.id, actor()))?.status).toBe('no_show');
      await expect(booking.noShow(a.id, actor())).rejects.toMatchObject({
        status: 409,
      });
      expect((await appointments.findById(a.id))?.history).toHaveLength(1);
    });
    it('rejects completion before scheduled start', async () => {
      const a = await book();
      await expect(booking.complete(a.id, actor())).rejects.toMatchObject({
        status: 409,
      });
    });
    it('retains ordinary manual completion exactly at start', async () => {
      const a = await book();
      jest.setSystemTime(new Date('2026-10-21T06:00:00Z'));
      expect((await booking.complete(a.id, actor()))?.status).toBe('completed');
    });
    it('retains scoped authorization for manual outcomes', async () => {
      const a = await book();
      await expect(booking.noShow(a.id, patient())).rejects.toMatchObject({
        status: 403,
      });
    });
    it.each(['2026-10-21T06:20:00Z', '2026-10-21T06:21:00Z'])(
      'rejects ordinary approval after original arrival grace at %s without an outbox event',
      async (time) => {
        const a = await book({ status: 'pending' });
        jest.setSystemTime(new Date(time));
        await expect(booking.approve(a.id, actor())).rejects.toMatchObject({
          status: 409,
        });
        expect(await outbox.countDocuments()).toBe(0);
        expect((await appointments.findById(a.id))?.status).toBe('pending');
      },
    );
    it('approval during grace retains the scheduled deadline', async () => {
      const a = await book({ status: 'pending' });
      jest.setSystemTime(new Date('2026-10-21T06:19:59.999Z'));
      expect((await booking.approve(a.id, actor()))?.status).toBe('confirmed');
      expect(
        await worker.applyDueNoShows(new Date('2026-10-21T06:20:00Z')),
      ).toBe(1);
    });
    it.each(['ordinary', 'patient_portal', 'phone'])(
      'rejects unresolved disruption in %s confirmation without a confirmation event',
      async (method) => {
        const a = await book({
          status: method === 'ordinary' ? 'pending' : 'confirmed',
        });
        const current =
          method === 'ordinary'
            ? a
            : await booking.reschedule(
                a.id,
                {
                  date: new Date('2026-10-21'),
                  startTime: '15:00',
                  endTime: '15:30',
                  reason: 'Timetable change',
                },
                actor(),
              );
        await outbox.deleteMany({});
        await appointments.updateOne(
          { _id: a.id },
          {
            $set: {
              disruption: {
                message: 'Clinic review required',
                closures: [],
                flaggedAt: new Date(),
              },
            },
          },
        );
        const response =
          method === 'ordinary'
            ? booking.approve(a.id, actor())
            : booking.respondToReschedule(
                a.id,
                {
                  proposalId: current!.rescheduleProposal!.id,
                  method: method as 'phone' | 'patient_portal',
                  ...(method === 'phone'
                    ? { reason: 'Patient agreed by phone' }
                    : {}),
                },
                method === 'phone' ? actor() : patient(),
              );
        await expect(response).rejects.toMatchObject({ status: 409 });
        expect(await outbox.countDocuments()).toBe(0);
        expect((await appointments.findById(a.id))?.status).toBe('pending');
      },
    );
    it('rejects proposal acceptance during an active visit without a confirmation event', async () => {
      const a = await book();
      const p = await booking.reschedule(
        a.id,
        {
          date: new Date('2026-10-21'),
          startTime: '15:00',
          endTime: '15:30',
          reason: 'Timetable change',
        },
        actor(),
      );
      await outbox.deleteMany({});
      await db
        .collection('visits')
        .insertOne({ appointment: a._id, state: 'waiting' });
      await expect(
        booking.respondToReschedule(
          a.id,
          { proposalId: p!.rescheduleProposal!.id, method: 'patient_portal' },
          patient(),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await outbox.countDocuments()).toBe(0);
    });
    it('clears a proposal when its linked referral is rejected', async () => {
      const referral = await referrals.create({
        patient: f.patient,
        fromDoctorId: f.dentist,
        fromClinicId: f.clinic,
        reason: 'Consultation requested',
      });
      const a = await book({ referral: referral._id });
      const p = await booking.reschedule(
        a.id,
        {
          date: new Date('2026-10-21'),
          startTime: '15:00',
          endTime: '15:30',
          reason: 'Timetable change',
        },
        actor(),
      );
      expect(p?.rescheduleProposal).toBeDefined();
      await booking.rejectLinkedReferral(
        referral.id,
        actor(),
        'Referral no longer needed',
      );
      const ended = await appointments.findById(a.id);
      expect(ended?.status).toBe('rejected');
      expect(ended?.rescheduleProposal).toBeUndefined();
    });
    it.each([undefined, 3])(
      'records schedule identity %s when a new visit checks in',
      async (version) => {
        const a = await book(
          version === undefined ? {} : { scheduleVersion: version },
        );
        await care.checkIn(actor(), {
          ...f,
          appointment: a.id,
          purpose: 'consultation',
        });
        expect(
          await db.collection('visits').findOne({ appointment: a._id }),
        ).toMatchObject({ appointmentScheduleVersion: version ?? 0 });
      },
    );
    it('requires care-case completion through the clinical visit even after start', async () => {
      const a = await book({ careCase: '64b000000000000000000001' });
      jest.setSystemTime(new Date('2026-10-21T06:00:00Z'));
      await expect(booking.complete(a.id, actor())).rejects.toMatchObject({
        status: 409,
      });
    });
    const attendance = [
      {
        name: 'prior-date legacy cancellation',
        date: '2026-10-20',
        state: 'cancelled',
        protects: false,
      },
      {
        name: 'prior-date previous version cancellation',
        date: '2026-10-20',
        state: 'cancelled',
        appointmentScheduleVersion: 1,
        protects: false,
      },
      {
        name: 'same-day previous version cancellation',
        date: '2026-10-21',
        state: 'cancelled',
        appointmentScheduleVersion: 1,
        protects: false,
      },
      {
        name: 'current version cancellation',
        date: '2026-10-21',
        state: 'cancelled',
        appointmentScheduleVersion: 2,
        protects: true,
      },
      {
        name: 'same-day legacy cancellation',
        date: '2026-10-21',
        state: 'cancelled',
        protects: true,
      },
      {
        name: 'legacy completed attendance',
        date: '2026-10-21',
        state: 'completed',
        protects: true,
      },
      {
        name: 'active old version visit',
        date: '2026-10-20',
        state: 'in_progress',
        appointmentScheduleVersion: 1,
        protects: true,
      },
    ];
    describe.each(['manual', 'automatic'])(
      '%s No-show attendance guard',
      (method) => {
        it('does not exempt a same-day accepted reschedule after the prior intake was cancelled', async () => {
          const a = await book();
          const intake = await care.checkIn(actor(), {
            ...f,
            appointment: a.id,
            purpose: 'consultation',
          });
          await care.transition(actor(), intake!._id.toString(), {
            state: 'cancelled',
            reason: 'Patient will return at a later time',
          });
          const proposal = await booking.reschedule(
            a.id,
            {
              date: new Date('2026-10-21'),
              startTime: '15:00',
              endTime: '15:30',
              reason: 'Patient returning later',
            },
            actor(),
          );
          await booking.respondToReschedule(
            a.id,
            {
              proposalId: proposal!.rescheduleProposal!.id,
              method: 'patient_portal',
            },
            patient(),
          );
          jest.setSystemTime(new Date('2026-10-21T07:20:00Z'));
          if (method === 'automatic')
            expect(await worker.applyDueNoShows(new Date())).toBe(1);
          else
            expect((await booking.noShow(a.id, actor()))?.status).toBe(
              'no_show',
            );
          expect((await appointments.findById(a.id))?.status).toBe('no_show');
        });
        it.each(attendance)('$name', async (row) => {
          const a = await book({ scheduleVersion: 2 });
          const { protects, name, ...visit } = row;
          await db
            .collection('visits')
            .insertOne({ appointment: a._id, ...visit });
          jest.setSystemTime(new Date('2026-10-21T06:20:00Z'));
          if (method === 'automatic')
            expect(await worker.applyDueNoShows(new Date())).toBe(
              protects ? 0 : 1,
            );
          else if (protects)
            await expect(booking.noShow(a.id, actor())).rejects.toMatchObject({
              status: 409,
            });
          else
            expect((await booking.noShow(a.id, actor()))?.status).toBe(
              'no_show',
            );
          expect((await appointments.findById(a.id))?.status).toBe(
            protects ? 'confirmed' : 'no_show',
          );
        });
      },
    );
  },
);
