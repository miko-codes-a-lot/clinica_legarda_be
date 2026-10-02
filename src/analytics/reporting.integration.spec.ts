import { ForbiddenException, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AnalyticsModule } from './analytics.module';
import { AnalyticsService } from './analytics.service';
import { Appointment } from '../appointments/entities/appointment.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import {
  DentalCatalog,
  DentalCatalogSchema,
} from '../dental-catalog/entities/dental-catalog.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';

const uri = process.env.TEST_MONGO_URI;
const localTests = uri ? describe : describe.skip;
localTests('Scoped appointment reports', () => {
  let app: INestApplication;
  let connection: Connection;
  let service: AnalyticsService;
  let appointments: Model<Appointment>;
  let referrals: Model<Referral>;
  const ids = {
    clinicA: new Types.ObjectId(),
    clinicB: new Types.ObjectId(),
    emptyClinic: new Types.ObjectId(),
    dentistA: new Types.ObjectId(),
    dentistB: new Types.ObjectId(),
    patient: new Types.ObjectId(),
    cleaning: new Types.ObjectId(),
    filling: new Types.ObjectId(),
  };
  const admin = { sub: ids.patient.toHexString(), role: 'super-admin' };
  const dentist = { sub: ids.dentistA.toHexString(), role: 'dentist' };
  const patient = { sub: ids.patient.toHexString(), role: 'user' };

  beforeAll(async () => {
    if (
      uri !==
      'mongodb://127.0.0.1:27028/clinica_test_ticket06?replicaSet=clinica-test'
    ) {
      throw new Error('Use only the isolated Ticket06 database.');
    }
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri),
        AnalyticsModule,
        MongooseModule.forFeature([
          { name: Clinic.name, schema: ClinicSchema },
          { name: User.name, schema: UserSchema },
          { name: DentalCatalog.name, schema: DentalCatalogSchema },
          { name: Referral.name, schema: ReferralSchema },
        ]),
      ],
      providers: [
        {
          provide: AuthService,
          useValue: {
            resolveActor: async (actor) => actor,
            verifyJwt: async (token: string) => {
              if (token === 'admin') return admin;
              if (token === 'dentist') return dentist;
              if (token === 'patient') return patient;
              throw new Error('Invalid fixture token');
            },
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    connection = module.get<Connection>(getConnectionToken());
    service = module.get(AnalyticsService);
    appointments = connection.model<Appointment>(Appointment.name);
    referrals = connection.model<Referral>(Referral.name);
    app = module.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });
  beforeEach(async () => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-09-16T02:00:00Z').getTime());
    await Promise.all(
      ['Appointment', 'Referral', 'Clinic', 'User', 'DentalCatalog'].map(
        (name) => connection.model(name).deleteMany({}),
      ),
    );
    await connection.model(Clinic.name).create([
      { _id: ids.clinicA, name: 'Clinic A' },
      { _id: ids.clinicB, name: 'Clinic B' },
      { _id: ids.emptyClinic, name: 'Empty' },
    ]);
    await connection
      .model(User.name)
      .create({ _id: ids.patient, firstName: 'Test', lastName: 'Patient' });
    await connection.model(DentalCatalog.name).create([
      { _id: ids.cleaning, name: 'Cleaning' },
      { _id: ids.filling, name: 'Filling' },
    ]);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (app) await app.close();
  });

  it('forbids patient access at the authenticated analytics boundary', async () => {
    await request(app.getHttpServer())
      .get(`/analytics/summary/${ids.clinicA}`)
      .set('Cookie', 'jwt=patient')
      .expect(403);
  });

  async function addAppointment(overrides: Record<string, unknown> = {}) {
    const record = {
      _id: new Types.ObjectId(),
      clinic: ids.clinicA,
      dentist: ids.dentistA,
      patient: ids.patient,
      services: [ids.cleaning],
      date: new Date('2026-09-16'),
      startTime: '09:00',
      endTime: '10:00',
      status: 'pending',
      createdAt: new Date('2026-08-01'),
      updatedAt: new Date('2026-08-01'),
      ...overrides,
    };
    await appointments.collection.insertOne(record);
    return record._id;
  }

  it('validates clinic IDs and requires authentication on report routes', async () => {
    for (const route of ['summary', 'trend', 'queue']) {
      await request(app.getHttpServer())
        .get(`/analytics/${route}/all`)
        .expect(401);
      await request(app.getHttpServer())
        .get(`/analytics/${route}/invalid`)
        .set('Cookie', 'jwt=admin')
        .expect(400);
    }
  });

  it('counts all appointment statuses and deduplicates services consistently across clinics', async () => {
    await addAppointment({
      services: [ids.cleaning, ids.cleaning, ids.filling],
    });
    await addAppointment({
      clinic: ids.clinicB,
      status: 'completed',
      date: new Date('2026-09-20'),
    });
    await addAppointment({ clinic: ids.clinicB, status: 'rejected' });
    await addAppointment({ date: new Date('2026-09-13') });
    await addAppointment({ date: new Date('2026-09-21') });
    const all = await service.getWeeklySummary('all', admin);
    const a = await service.getWeeklySummary(
      ids.clinicA.toHexString().toUpperCase(),
      admin,
    );
    const b = await service.getWeeklySummary(ids.clinicB.toHexString(), admin);
    expect(all).toMatchObject({
      weekOf: '2026-09-14',
      weekEnd: '2026-09-20',
      today: '2026-09-16',
      totalAppointments: 3,
      preferredServices: { Cleaning: 3, Filling: 1 },
    });
    expect(all.totalAppointments).toBe(
      a.totalAppointments + b.totalAppointments,
    );
    expect(a).toMatchObject({
      totalAppointments: 1,
      preferredServices: { Cleaning: 1, Filling: 1 },
    });
    expect(b.totalAppointments).toBe(2);
    for (const name of Object.keys(all.preferredServices)) {
      expect(all.preferredServices[name]).toBe(
        (a.preferredServices[name] ?? 0) + (b.preferredServices[name] ?? 0),
      );
    }
    const allTrend = await service.getWeeklyAppointmentTrend('all', admin);
    const aTrend = await service.getWeeklyAppointmentTrend(
      ids.clinicA.toHexString(),
      admin,
    );
    const bTrend = await service.getWeeklyAppointmentTrend(
      ids.clinicB.toHexString(),
      admin,
    );
    for (let day = 0; day < 7; day++) {
      expect(allTrend.appointments[day]).toBe(
        aTrend.appointments[day] + bTrend.appointments[day],
      );
      expect(allTrend.completed[day]).toBe(
        aTrend.completed[day] + bTrend.completed[day],
      );
    }
    expect(await service.getWeeklyAppointmentTrend('all', admin)).toMatchObject(
      {
        weekOf: '2026-09-14',
        weekEnd: '2026-09-20',
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        appointments: [0, 0, 2, 0, 0, 0, 1],
        completed: [0, 0, 0, 0, 0, 0, 1],
        serviceTrend: {
          Cleaning: [0, 0, 2, 0, 0, 0, 1],
          Filling: [0, 0, 1, 0, 0, 0, 0],
        },
      },
    );
  });

  it('counts completion without removing appointment totals', async () => {
    const id = await addAppointment({ status: 'confirmed' });
    expect(await service.getWeeklyAppointmentTrend('all', admin)).toMatchObject(
      { appointments: [0, 0, 1, 0, 0, 0, 0], completed: [0, 0, 0, 0, 0, 0, 0] },
    );
    await appointments.collection.updateOne(
      { _id: id },
      { $set: { status: 'completed' } },
    );
    expect(await service.getWeeklyAppointmentTrend('all', admin)).toMatchObject(
      { appointments: [0, 0, 1, 0, 0, 0, 0], completed: [0, 0, 1, 0, 0, 0, 0] },
    );
    expect(await service.getWeeklySummary('all', admin)).toMatchObject({
      totalAppointments: 1,
    });
  });

  it('intersects dentist ownership with clinic filters for every report and rejects patients', async () => {
    const updatedAt = new Date('2026-09-14T00:00:00Z');
    await addAppointment({ status: 'confirmed', updatedAt });
    await addAppointment({
      clinic: ids.clinicB,
      status: 'confirmed',
      updatedAt,
    });
    await addAppointment({
      dentist: ids.dentistB,
      status: 'confirmed',
      updatedAt,
    });
    for (const clinicId of [
      'all',
      ids.clinicA.toHexString(),
      ids.clinicB.toHexString(),
    ]) {
      const count = clinicId === 'all' ? 2 : 1;
      expect(await service.getWeeklySummary(clinicId, dentist)).toMatchObject({
        totalAppointments: count,
        appointmentsUpdated: count,
      });
      expect(
        await service.getWeeklyAppointmentTrend(clinicId, dentist),
      ).toMatchObject({ appointments: [0, 0, count, 0, 0, 0, 0] });
      expect(
        await service.getDailyAppointmentQueue(clinicId, dentist),
      ).toHaveLength(count);
    }
    for (const method of [
      service.getWeeklySummary,
      service.getWeeklyAppointmentTrend,
      service.getDailyAppointmentQueue,
    ]) {
      await expect(method.call(service, 'all', patient)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
    expect(
      await service.getWeeklySummary('all', { ...admin, role: 'super-admin' }),
    ).toMatchObject({ totalAppointments: 3, appointmentsUpdated: 3 });
    const summaryA = await service.getWeeklySummary(
      ids.clinicA.toHexString(),
      admin,
    );
    const summaryB = await service.getWeeklySummary(
      ids.clinicB.toHexString(),
      admin,
    );
    expect(summaryA.appointmentsUpdated + summaryB.appointmentsUpdated).toBe(3);
  });

  it('joins declined referrals through the receiving appointment, including dentist ownership and week', async () => {
    const rejected = new Types.ObjectId();
    const unspecified = new Types.ObjectId();
    const outside = new Types.ObjectId();
    const approved = new Types.ObjectId();
    const receiving = await addAppointment({
      clinic: ids.clinicB,
      referral: rejected,
    });
    await addAppointment({
      clinic: ids.clinicB,
      dentist: ids.dentistB,
      referral: unspecified,
    });
    const old = await addAppointment({
      date: new Date('2026-09-13'),
      referral: outside,
    });
    await addAppointment({ clinic: ids.clinicB, referral: approved });
    await referrals.collection.insertMany([
      {
        _id: rejected,
        fromClinicId: ids.clinicA,
        fromDoctorId: ids.dentistB,
        status: 'rejected',
        reasonOfDecline: 'capacity',
      },
      // A stale legacy reverse field must not override the actual receiving link.
      {
        _id: unspecified,
        fromClinicId: ids.clinicA,
        fromDoctorId: ids.dentistB,
        appointment: old,
        status: 'rejected',
        reasonOfDecline: '',
      },
      {
        _id: outside,
        fromClinicId: ids.clinicB,
        status: 'rejected',
        reasonOfDecline: 'outside',
      },
      {
        fromClinicId: ids.clinicA,
        appointment: receiving,
        status: 'rejected',
        reasonOfDecline: 'unlinked',
      },
      {
        _id: approved,
        fromClinicId: ids.clinicA,
        status: 'approved',
        reasonOfDecline: 'approved',
      },
    ]);
    const a = await service.getWeeklySummary(ids.clinicA.toHexString(), admin);
    const b = await service.getWeeklySummary(ids.clinicB.toHexString(), admin);
    const all = await service.getWeeklySummary('all', admin);
    const own = await service.getWeeklySummary('all', dentist);
    expect(a.declinedReferrals).toEqual({});
    expect(b.declinedReferrals).toEqual({ capacity: 1, Unspecified: 1 });
    expect(all.declinedReferrals).toEqual({ capacity: 1, Unspecified: 1 });
    expect(own.declinedReferrals).toEqual({ capacity: 1 });
  });

  it('uses Manila Monday boundaries with separate calendar-day and update-instant ranges', async () => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-09-13T16:00:00Z').getTime());
    await addAppointment({
      date: new Date('2026-09-14'),
      updatedAt: new Date('2026-09-13T15:59:59.999Z'),
    });
    await addAppointment({
      date: new Date('2026-09-20'),
      updatedAt: new Date('2026-09-13T16:00:00Z'),
    });
    await addAppointment({
      date: new Date('2026-10-01'),
      updatedAt: new Date('2026-09-20T15:59:59.999Z'),
    });
    await addAppointment({
      date: new Date('2026-09-13'),
      updatedAt: new Date('2026-09-20T16:00:00Z'),
    });
    expect(await service.getWeeklySummary('all', admin)).toMatchObject({
      weekOf: '2026-09-14',
      weekEnd: '2026-09-20',
      today: '2026-09-14',
      totalAppointments: 2,
      appointmentsUpdated: 2,
    });
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-09-13T15:59:59.999Z').getTime());
    expect(await service.getWeeklySummary('all', admin)).toMatchObject({
      weekOf: '2026-09-07',
      weekEnd: '2026-09-13',
      today: '2026-09-13',
      totalAppointments: 1,
      appointmentsUpdated: 1,
    });
  });

  it('returns every confirmed appointment today with all services and clinic labels in time order', async () => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-09-15T16:00:00Z').getTime());
    for (let i = 6; i >= 0; i--)
      await addAppointment({
        status: 'confirmed',
        startTime: `0${i + 1}:00`,
        services: [ids.cleaning, ids.filling, ids.cleaning],
        clinic: i % 2 ? ids.clinicA : ids.clinicB,
      });
    await addAppointment({ status: 'pending' });
    await addAppointment({ status: 'completed' });
    await addAppointment({ status: 'confirmed', date: new Date('2026-09-15') });
    const queue = await service.getDailyAppointmentQueue('all', admin);
    expect(queue).toHaveLength(7);
    expect(queue.map((row) => row.time)).toEqual([
      '01:00',
      '02:00',
      '03:00',
      '04:00',
      '05:00',
      '06:00',
      '07:00',
    ]);
    expect(queue[0]).toMatchObject({
      appointmentId: expect.any(String),
      patientName: 'Test Patient',
      service: 'Cleaning, Filling',
      clinicId: ids.clinicB.toHexString(),
      clinicName: 'Clinic B',
    });
  });

  it('returns zero/empty report state for a clinic without appointments', async () => {
    const clinicId = ids.emptyClinic.toHexString();
    expect(await service.getWeeklySummary(clinicId, admin)).toMatchObject({
      totalAppointments: 0,
      appointmentsUpdated: 0,
      preferredServices: {},
      declinedReferrals: {},
    });
    expect(
      await service.getWeeklyAppointmentTrend(clinicId, admin),
    ).toMatchObject({
      appointments: [0, 0, 0, 0, 0, 0, 0],
      completed: [0, 0, 0, 0, 0, 0, 0],
      serviceTrend: {},
    });
    expect(await service.getDailyAppointmentQueue(clinicId, admin)).toEqual([]);
  });
});
