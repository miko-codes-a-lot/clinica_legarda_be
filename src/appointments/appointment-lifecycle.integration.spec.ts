import {
  ConflictException,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Connection, createConnection, Model } from 'mongoose';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AppointmentStatus as Status } from '../_shared/enum/appointment-status.enum';
import { Appointment, AppointmentSchema } from './entities/appointment.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import {
  DentalCatalog,
  DentalCatalogSchema,
} from '../dental-catalog/entities/dental-catalog.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { AppointmentsService } from './appointments.service';
import { AppointmentSchedulingService } from './appointment-scheduling.service';
import { AppointmentsController } from './appointments.controller';

const uri = process.env.TEST_MONGO_URI;
const localTests = uri ? describe : describe.skip;
localTests('Appointment lifecycle', () => {
  let connection: Connection;
  let otherConnection: Connection;
  let app: INestApplication;
  let appointments: Model<Appointment>;
  let users: Model<User>;
  let clinics: Model<Clinic>;
  let referrals: Model<Referral>;
  let service: AppointmentsService;
  let otherService: AppointmentsService;
  let fixture: {
    patient: string;
    dentist: string;
    otherDentist: string;
    clinic: string;
    appointment: string;
    referral: string;
  };
  const hours = [{ day: 'monday', startTime: '08:00', endTime: '18:00' }];
  const date = new Date('2026-09-21');
  const admin = {
    sub: '64b000000000000000000099',
    role: 'super-admin',
    username: 'Staff account',
  };
  const actor = (role: 'user' | 'dentist') => ({
    sub: role === 'user' ? fixture.patient : fixture.dentist,
    role,
    username: 'Fixture actor',
  });
  function setup(connection: Connection) {
    const appointments = connection.model(Appointment.name, AppointmentSchema);
    const users = connection.model(User.name, UserSchema);
    const clinics = connection.model(Clinic.name, ClinicSchema);
    const referrals = connection.model(Referral.name, ReferralSchema);
    const catalog = connection.model(DentalCatalog.name, DentalCatalogSchema);
    return {
      appointments,
      users,
      clinics,
      referrals,
      service: new AppointmentsService(
        appointments,
        new AppointmentSchedulingService(appointments, users, clinics, catalog),
        referrals, users,
      ),
    };
  }
  beforeAll(async () => {
    if (
      uri !==
      'mongodb://127.0.0.1:27028/clinica_test_ticket08?replicaSet=clinica-test'
    )
      throw new Error('Use only the isolated Ticket08 database.');
    connection = await createConnection(uri).asPromise();
    otherConnection = await createConnection(uri).asPromise();
    ({ appointments, users, clinics, referrals, service } = setup(connection));
    otherService = setup(otherConnection).service;
    const module = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [
        { provide: AppointmentsService, useValue: service },
        {
          provide: AuthService,
          useValue: {
            resolveActor: async (actor) => actor,
            verifyJwt: async (token: string) => {
              if (token === 'dentist') return actor('dentist');
              if (token === 'patient') return actor('user');
              throw new Error('Invalid fixture token');
            },
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
    await appointments.deleteMany({});
    await referrals.deleteMany({});
    await users.deleteMany({});
    await clinics.deleteMany({});
    const clinic = await clinics.create({
      name: 'Lifecycle clinic',
      operatingHours: hours,
    });
    const people = await users.create([
      { role: 'user', status: 'confirmed', firstName: 'Patient' },
      {
        role: 'dentist',
        firstName: 'Doctor',
        status: 'confirmed',
        clinics: [clinic._id],
        operatingHours: hours,
      },
      {
        role: 'dentist',
        firstName: 'Source',
        status: 'confirmed',
        clinics: [clinic._id],
        operatingHours: hours,
      },
    ]);
    const referral = await referrals.create({
      fromDoctorId: people[2]._id,
      fromClinicId: clinic._id,
      reason: 'Fixture referral',
    });
    const appointment = await appointments.create({
      patient: people[0]._id,
      dentist: people[1]._id,
      clinic: clinic._id,
      referral: referral._id,
      date,
      startTime: '09:00',
      endTime: '10:00',
      status: Status.CONFIRMED,
      history: [
        {
          action: 'Legacy event',
          reason: 'Preserve this',
          timestamp: new Date('2026-09-01'),
        },
      ],
    });
    fixture = {
      patient: people[0].id,
      dentist: people[1].id,
      otherDentist: people[2].id,
      clinic: clinic.id,
      appointment: appointment.id,
      referral: referral.id,
    };
  });
  afterAll(async () => {
    await app?.close();
    await connection?.close();
    await otherConnection?.close();
  });
  const booking = () => ({
    clinic: fixture.clinic,
    patient: fixture.patient,
    dentist: fixture.dentist,
    date,
    startTime: '14:00',
    endTime: '15:00',
  });
  const setStatus = async (status: Status) =>
    appointments.updateOne({ _id: fixture.appointment }, { $set: { status } });

  it('records the authenticated creator and ignores forged creator/history in creation and edits', async () => {
    const forged = { createdBy: fixture.dentist, history: [{ action: 'Appointment created.', actorId: fixture.dentist }] };
    const created = await service.create({ ...booking(), ...forged }, actor('user'));
    expect(created.createdBy?.toString()).toBe(fixture.patient);
    expect(created.history[0].actorId).toBe(fixture.patient);
    await service.update(created._id.toString(), { ...booking(), ...forged }, admin);
    const stored = await appointments.findById(created._id.toString());
    expect(stored?.createdBy?.toString()).toBe(fixture.patient);
    expect(stored?.history[0].actorId).toBe(fixture.patient);
    await service.reschedule(created._id.toString(), { date, startTime: '15:00', endTime: '16:00' }, actor('dentist'));
    expect((await appointments.findById(created._id.toString()))?.createdBy?.toString()).toBe(fixture.patient);
    await expect(service.cancel(created._id.toString(), actor('dentist'))).rejects.toBeInstanceOf(ForbiddenException);
    await service.cancel(created._id.toString(), actor('user'), 'Plans changed');
  });

  it.each(['user', 'dentist', 'admin', 'super-admin'] as const)('allows only the %s creator to cancel, with no staff override', async role => {
    const owner = role === 'user' || role === 'dentist' ? actor(role) : { ...admin, role, clinics: [fixture.clinic] };
    const created = await service.create(booking(), owner);
    const nonOwner = role === 'user' ? admin : actor('user');
    const before = await appointments.findById(created._id.toString()).lean();
    await expect(service.cancel(created._id.toString(), nonOwner, 'No permission')).rejects.toBeInstanceOf(ForbiddenException);
    expect(await appointments.findById(created._id.toString()).lean()).toEqual(before);
    const result = await service.cancel(created._id.toString(), owner, '  Plans changed  ');
    expect(result.status).toBe(Status.CANCELLED);
    expect(result.history.at(-1)).toMatchObject({ reason: 'Plans changed', actorId: owner.sub });
  });

  it('enforces cancellation ownership at the authenticated HTTP endpoint', async () => {
    const created = await service.create(booking(), actor('user'));
    await request(app.getHttpServer()).patch(`/appointments/${created._id.toString()}/cancel`)
      .set('Cookie', 'jwt=dentist').send({ reason: 'Closed', createdBy: fixture.dentist }).expect(403);
    expect((await appointments.findById(created._id.toString()))?.status).toBe(Status.PENDING);
    await request(app.getHttpServer()).patch(`/appointments/${created._id.toString()}/cancel`)
      .set('Cookie', 'jwt=patient').send({ reason: 'Plans changed' }).expect(200);
  });

  it('requires a reason before atomically saving rejection and its attributed history', async () => {
    await setStatus(Status.PENDING);
    const before = await appointments.findById(fixture.appointment).lean();
    await request(app.getHttpServer()).patch(`/appointments/${fixture.appointment}/reject`)
      .set('Cookie', 'jwt=dentist').send({}).expect(400);
    expect(await appointments.findById(fixture.appointment).lean()).toEqual(before);
    await request(app.getHttpServer()).patch(`/appointments/${fixture.appointment}/reject`)
      .set('Cookie', 'jwt=dentist').send({ reason: '  Dentist unavailable  ' }).expect(200);
    const stored = await appointments.findById(fixture.appointment);
    expect(stored?.status).toBe(Status.REJECTED);
    expect(stored?.history).toHaveLength(2);
    expect(stored?.history.at(-1)).toMatchObject({ reason: 'Dentist unavailable', actorId: fixture.dentist, actorRole: 'dentist' });
  });

  it('blocks terminal rescheduling without changing the slot or history', async () => {
    await setStatus(Status.COMPLETED);
    const before = (await appointments.findById(fixture.appointment).lean())!;
    await expect(
      service.reschedule(fixture.appointment, booking(), admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await appointments.findById(fixture.appointment).lean()).toEqual(
      before,
    );
  });
  it.each(['complete', 'no-show'])(
    'exposes authenticated %s with a populated outcome response',
    async (outcome) => {
      const route = `/appointments/${fixture.appointment}/${outcome}`;
      await request(app.getHttpServer()).patch(route).expect(401);
      await request(app.getHttpServer())
        .patch(route)
        .set('Cookie', 'jwt=patient')
        .expect(403);
      const response = await request(app.getHttpServer())
        .patch(route)
        .set('Cookie', 'jwt=dentist')
        .expect(200);
      expect(response.body.status).toBe(
        outcome === 'complete' ? Status.COMPLETED : Status.NO_SHOW,
      );
      expect(response.body.patient._id).toBe(fixture.patient);
      expect(response.body.clinic._id).toBe(fixture.clinic);
      expect(response.body.referral.fromDoctorId._id).toBe(
        fixture.otherDentist,
      );
      expect(response.body.history.at(-1)).toMatchObject({
        actorId: fixture.dentist,
        actorRole: 'dentist',
        actorName: 'Fixture actor',
      });
    },
  );
  it.each([
    Status.COMPLETED,
    Status.NO_SHOW,
    Status.REJECTED,
    Status.CANCELLED,
  ])(
    'protects %s through every older mutation including source-referral rejection',
    async (status) => {
      await setStatus(status);
      const before = await appointments.findById(fixture.appointment).lean();
      const referralBefore = await referrals.findById(fixture.referral).lean();
      const operations = [
        () => service.approve(fixture.appointment, admin),
        () => service.reject(fixture.appointment, admin, 'Dentist unavailable'),
        () => service.cancel(fixture.appointment, admin),
        () => service.update(fixture.appointment, booking(), admin),
        () => service.reschedule(fixture.appointment, booking(), admin),
        () =>
          service.rejectLinkedReferral(
            fixture.referral,
            { sub: fixture.otherDentist, role: 'dentist' },
            'Decline',
          ),
      ];
      for (const operation of operations)
        await expect(operation()).rejects.toBeInstanceOf(ConflictException);
      expect(await appointments.findById(fixture.appointment).lean()).toEqual(
        before,
      );
      expect(await referrals.findById(fixture.referral).lean()).toEqual(
        referralBefore,
      );
    },
  );
  it('requires pending for generic edits and appointment approval/rejection', async () => {
    await expect(
      service.update(fixture.appointment, booking(), admin),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.approve(fixture.appointment, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.reject(fixture.appointment, admin, 'Dentist unavailable'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['complete', 'noShow'] as const)(
    'allows %s for the owning dentist after membership removal, preserves history and adds attribution',
    async (outcome) => {
      await users.updateOne(
        { _id: fixture.dentist },
        { $set: { clinics: [] } },
      );
      const before = (await appointments.findById(fixture.appointment).lean())!
        .history[0];
      const result = await service[outcome](fixture.appointment, {
        ...actor('dentist'),
        sub: fixture.dentist.toUpperCase(),
      });
      expect(result.status).toBe(
        outcome === 'complete' ? Status.COMPLETED : Status.NO_SHOW,
      );
      expect(result.history).toHaveLength(2);
      expect(JSON.parse(JSON.stringify(result.history[0]))).toEqual(JSON.parse(JSON.stringify(before)));
      expect(result.history[1]).toMatchObject({
        actorId: fixture.dentist,
        actorRole: 'dentist',
        actorName: 'Fixture actor',
      });
      expect(result.history[1].timestamp).toBeInstanceOf(Date);
    },
  );
  it.each(['complete', 'noShow'] as const)(
    'denies cross-dentist %s and pending/final outcomes without mutations',
    async (outcome) => {
      await expect(
        service[outcome](fixture.appointment, {
          sub: fixture.otherDentist,
          role: 'dentist',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      for (const status of [
        Status.PENDING,
        Status.COMPLETED,
        Status.NO_SHOW,
        Status.REJECTED,
        Status.CANCELLED,
      ]) {
        await setStatus(status);
        const before = await appointments.findById(fixture.appointment).lean();
        await expect(
          service[outcome](fixture.appointment, admin),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(await appointments.findById(fixture.appointment).lean()).toEqual(
          before,
        );
      }
    },
  );
  it.each(['admin', 'super-admin'])(
    'allows %s oversight to record outcomes without requiring a reason',
    async (role) => {
      const result = await service.complete(fixture.appointment, {
        ...admin,
        role, clinics: [fixture.clinic],
      });
      expect(result.status).toBe(Status.COMPLETED);
      expect(result.history.at(-1)).toMatchObject({
        actorId: admin.sub,
        actorRole: role,
        actorName: admin.username,
      });
    },
  );
  it('keeps authorized clinical recordkeeping available after an outcome', async () => {
    await service.complete(fixture.appointment, admin);
    await expect(
      service.updateDentistNotes(
        fixture.appointment,
        'Patient injection',
        actor('user'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const result = await service.updateDentistNotes(
      fixture.appointment,
      'Follow-up notes',
      actor('dentist'),
    );
    expect(result.status).toBe(Status.COMPLETED);
    expect(result.notes.clinicNotes).toBe('Follow-up notes');
    expect(result.history).toHaveLength(3);
    expect(result.history.at(-1)).toMatchObject({
      action: 'Clinical notes updated.',
      actorId: fixture.dentist,
    });
  });
  it.each(['noShow', 'complete', 'reschedule'] as const)(
    'serializes completion against %s through independent database connections',
    async (competing) => {
      const other =
        competing === 'reschedule'
          ? () =>
              otherService.reschedule(
                fixture.appointment,
                booking(),
                actor('user'),
              )
          : () =>
              otherService[competing](fixture.appointment, actor('dentist'));
      const results = await Promise.allSettled([
        service.complete(fixture.appointment, admin),
        other(),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const failure = results.find((result) => result.status === 'rejected');
      expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(
        ConflictException,
      );
      const saved = (await appointments.findById(fixture.appointment))!;
      expect(saved.history).toHaveLength(2);
      if (saved.status === Status.PENDING) {
        expect(competing).toBe('reschedule');
        expect(saved.startTime).toBe('14:00');
        expect(saved.history.at(-1)?.action).toBe('Appointment rescheduled.');
      } else {
        expect([Status.COMPLETED, Status.NO_SHOW]).toContain(saved.status);
        expect(saved.startTime).toBe('09:00');
        expect(saved.history.at(-1)?.action).toBe(
          saved.status === Status.COMPLETED
            ? 'Appointment completed.'
            : 'Appointment marked as no show.',
        );
      }
    },
  );
  it.each(['complete', 'reschedule'] as const)(
    'rolls back %s and history if persistence fails after the conditional write',
    async (operation) => {
      const before = await appointments.findById(fixture.appointment).lean();
      const original = appointments.findOneAndUpdate.bind(appointments);
      const failure = jest
        .spyOn(appointments, 'findOneAndUpdate')
        .mockImplementation((...args: Parameters<typeof original>) => {
          const query = original(...args);
          const exec = query.exec.bind(query);
          query.exec = async () => {
            await exec();
            throw new Error('Injected persistence failure');
          };
          return query;
        });
      try {
        await expect(
          operation === 'complete'
            ? service.complete(fixture.appointment, admin)
            : service.reschedule(fixture.appointment, booking(), actor('user')),
        ).rejects.toThrow('Injected persistence failure');
      } finally {
        failure.mockRestore();
      }
      expect(await appointments.findById(fixture.appointment).lean()).toEqual(
        before,
      );
    },
  );
  it('keeps the original slot/history when rescheduling validation fails', async () => {
    const before = await appointments.findById(fixture.appointment).lean();
    await expect(
      service.reschedule(
        fixture.appointment,
        { ...booking(), startTime: '19:00', endTime: '20:00' },
        actor('user'),
      ),
    ).rejects.toThrow();
    expect(await appointments.findById(fixture.appointment).lean()).toEqual(
      before,
    );
  });
  it('reschedules using stored identities even if compatibility echoes are forged, retaining old history', async () => {
    const result = await service.reschedule(
      fixture.appointment,
      {
        ...booking(),
        patient: fixture.otherDentist,
        dentist: fixture.otherDentist,
        reason: '  New time  ',
      },
      actor('user'),
    );
    expect(result.patient._id.toString()).toBe(fixture.patient);
    expect(result.dentist._id.toString()).toBe(fixture.dentist);
    expect(result.status).toBe(Status.PENDING);
    expect(result.startTime).toBe('14:00');
    expect(result.history).toHaveLength(2);
    expect(result.history[0]).toMatchObject({
      action: 'Legacy event',
      reason: 'Preserve this',
    });
    expect(result.history.at(-1)).toMatchObject({
      action: 'Appointment rescheduled.',
      reason: 'New time',
      actorId: fixture.patient,
      actorRole: 'user',
    });
  });
  it('accepts reschedule requests without compatibility identities or a legacy reason at the DTO boundary', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/appointments/${fixture.appointment}/reschedule`)
      .set('Cookie', 'jwt=patient')
      .send({ date: '2026-09-21', startTime: '14:00', endTime: '15:00' })
      .expect(200);
    expect(response.body.status).toBe(Status.PENDING);
    expect(response.body.date).toBe('2026-09-21T00:00:00.000Z');
    expect(response.body.patient._id).toBe(fixture.patient);
  });

  it('converts validated calendar dates on booking and pending updates at the HTTP boundary', async () => {
    const created = await request(app.getHttpServer())
      .post('/appointments')
      .set('Cookie', 'jwt=patient')
      .send(booking())
      .expect(201);
    const updated = await request(app.getHttpServer())
      .put(`/appointments/${created.body._id}`)
      .set('Cookie', 'jwt=patient')
      .send({ ...booking(), startTime: '16:00', endTime: '17:00' })
      .expect(200);
    expect(updated.body.date).toBe('2026-09-21T00:00:00.000Z');
    expect(updated.body.status).toBe(Status.PENDING);
  });
});
