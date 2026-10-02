import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { Connection, createConnection, Model, Types } from 'mongoose';
import { Server, Socket } from 'socket.io';
import * as request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { MailerService } from '../mailer/mailer.service';
import { OtpService } from '../otp/otp.service';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/entities/appointment.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  Notification,
  NotificationSchema,
  NotificationType,
} from './entities/notification.entity';
import { NotificationListenerService } from './notification-listener.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RtNotificationsGateway } from './rt-notifications.gateway';

const uri = process.env.TEST_ADMIN_NOTIFICATION_MONGO_URI;
const isolated = uri ? describe : describe.skip;

// Removing recipient clinic checks exposes B identities or stale membership access.
isolated('Notification privacy using current clinic assignments', () => {
  let connection: Connection;
  let app: INestApplication;
  let users: Model<User>;
  let clinics: Model<Clinic>;
  let appointments: Model<Appointment>;
  let notifications: Model<Notification>;
  let service: NotificationsService;
  let gateway: RtNotificationsGateway;
  let emitter: EventEmitter2;
  let onChange: (change: object) => void;
  const sent: { socket: string; payload: Notification }[] = [];
  let fixture: {
    admin: string;
    outsideAdmin: string;
    unassignedAdmin: string;
    superAdmin: string;
    patient: string;
    dentist: string;
    clinicA: string;
    clinicB: string;
    appointmentA: string;
    appointmentB: string;
  };

  beforeAll(async () => {
    if (
      uri !==
      'mongodb://127.0.0.1:27028/clinica_admin_notifications_test?replicaSet=clinica-test'
    )
      throw new Error('Use only the isolated notification test database.');
    connection = await createConnection(uri).asPromise();
    users = connection.model(User.name, UserSchema);
    clinics = connection.model(Clinic.name, ClinicSchema);
    appointments = connection.model(Appointment.name, AppointmentSchema);
    notifications = connection.model(Notification.name, NotificationSchema);
    const userService = new UsersService(users, clinics, appointments);
    const tokenActor = (token: string) => {
      if (token === 'admin')
        return {
          sub: fixture.admin,
          role: 'admin',
          clinics: [fixture.clinicB],
        };
      if (token === 'unassigned')
        return {
          sub: fixture.unassignedAdmin,
          role: 'admin',
          clinics: [fixture.clinicA],
        };
      if (token === 'super')
        return { sub: fixture.superAdmin, role: 'super-admin' };
      if (token === 'patient') return { sub: fixture.patient, role: 'user' };
      if (token === 'dentist') return { sub: fixture.dentist, role: 'dentist' };
      if (token === 'pending')
        return { sub: fixture.patient, role: 'user', otpPending: true };
      throw new Error('Invalid test token');
    };
    const auth = new AuthService(
      {
        verifyAsync: async (token: string) => tokenActor(token),
      } as unknown as JwtService,
      userService,
      {} as OtpService,
      {} as MailerService,
    );
    emitter = new EventEmitter2();
    const module = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        NotificationsService,
        RtNotificationsGateway,
        NotificationListenerService,
        { provide: getModelToken(Notification.name), useValue: notifications },
        { provide: getModelToken(Appointment.name), useValue: appointments },
        { provide: UsersService, useValue: userService },
        { provide: AuthService, useValue: auth },
        { provide: EventEmitter2, useValue: emitter },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    service = module.get(NotificationsService);
    gateway = module.get(RtNotificationsGateway);
    // Change stream is the external event boundary; reads and writes use real Mongo.
    jest.spyOn(appointments.collection, 'watch').mockImplementation(
      () =>
        ({
          on: (_event: string, callback: typeof onChange) => {
            onChange = callback;
          },
        }) as unknown as ReturnType<typeof appointments.collection.watch>,
    );
    app = module.createNestApplication();
    app.use(cookieParser());
    await app.init();
    gateway.server = {
      to: (socket: string) => ({
        emit: (_event: string, payload: Notification) => {
          sent.push({ socket, payload });
        },
      }),
    } as unknown as Server;
  });

  beforeEach(async () => {
    await Promise.all([
      users.deleteMany({}),
      clinics.deleteMany({}),
      appointments.deleteMany({}),
      notifications.deleteMany({}),
    ]);
    const places = await clinics.create([
      { name: 'Clinic A' },
      { name: 'Clinic B' },
    ]);
    const people = await users.create([
      { username: 'admin-a', role: 'admin', clinics: [places[0]._id] },
      { username: 'admin-b', role: 'admin', clinics: [places[1]._id] },
      {
        username: 'admin-empty',
        role: 'admin',
        clinics: [],
        clinic: places[0]._id,
      },
      { username: 'super', role: 'super-admin' },
      {
        username: 'patient-ab',
        role: 'user',
        firstName: 'Patient',
        lastName: 'Learning',
      },
      {
        username: 'dentist-ab',
        role: 'dentist',
        firstName: 'Dentist',
        lastName: 'Learning',
        clinics: places.map((place) => place._id),
      },
    ]);
    const records = await appointments.create(
      places.map((place, index) => ({
        clinic: place._id,
        patient: people[4]._id,
        dentist: people[5]._id,
        date: new Date('2026-10-05'),
        startTime: index === 0 ? '09:00' : '11:00',
        endTime: index === 0 ? '10:00' : '12:00',
      })),
    );
    fixture = {
      admin: people[0].id,
      outsideAdmin: people[1].id,
      unassignedAdmin: people[2].id,
      superAdmin: people[3].id,
      patient: people[4].id,
      dentist: people[5].id,
      clinicA: places[0].id,
      clinicB: places[1].id,
      appointmentA: records[0].id,
      appointmentB: records[1].id,
    };
    sent.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
    await connection?.close();
  });

  const notice = (
    recipient: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) =>
    notifications.create({
      recipient,
      message,
      type: NotificationType.APPOINTMENT_CREATED,
      ...extra,
    });
  const get = (token = 'admin') =>
    request(app.getHttpServer())
      .get('/notifications')
      .set('Cookie', `jwt=${token}`);
  const read = (id: string, token = 'admin') =>
    request(app.getHttpServer())
      .patch(`/notifications/${id}/read`)
      .set('Cookie', `jwt=${token}`);
  const socket = (token: string, id = token) =>
    ({
      id,
      handshake: { headers: { cookie: `jwt=${token}` } },
      disconnect: jest.fn(),
    }) as unknown as Socket;

  it('filters new associations, recognized legacy links, unknown and missing notices by the appointment current clinic', async () => {
    await notice(fixture.admin, 'Associated A', {
      appointment: fixture.appointmentA,
      link: '/admin/dashboard',
    });
    await notice(fixture.admin, 'Associated B overrides A link', {
      appointment: fixture.appointmentB,
      link: `/admin/appointment/details/${fixture.appointmentA}`,
    });
    await notice(fixture.admin, 'Legacy A', {
      link: `/admin/appointment/details/${fixture.appointmentA}`,
    });
    await notice(fixture.admin, 'Legacy B', {
      link: `/admin/appointment/details/${fixture.appointmentB}`,
    });
    await notice(fixture.admin, 'Unknown', { link: '/admin/dashboard' });
    await notice(fixture.admin, 'Malformed', {
      link: '/admin/appointment/details/invalid',
    });
    await notice(fixture.admin, 'Missing appointment', {
      link: `/admin/appointment/details/${new Types.ObjectId()}`,
    });
    const response = await get().expect(200);
    expect(
      response.body.map((row: { message: string }) => row.message).sort(),
    ).toEqual(['Associated A', 'Legacy A']);
  });

  it('allows assigned read state changes while denying outside and unknown records', async () => {
    const own = await notice(fixture.admin, 'Own', {
      link: `/admin/appointment/details/${fixture.appointmentA}`,
    });
    const outside = await notice(fixture.admin, 'Outside', {
      link: `/admin/appointment/details/${fixture.appointmentB}`,
    });
    const unknown = await notice(fixture.admin, 'Unknown');
    await read(own.id).expect(200);
    expect((await notifications.findById(own.id))?.read).toBe(true);
    await read(outside.id).expect(403);
    await read(unknown.id).expect(403);
    expect((await notifications.findById(outside.id))?.read).toBe(false);
    expect((await notifications.findById(unknown.id))?.read).toBe(false);
  });

  it('keeps notification ownership when an assigned admin forges another recipient record ID', async () => {
    const other = await notice(fixture.outsideAdmin, 'Another recipient', {
      appointment: fixture.appointmentA,
    });
    const response = await read(other.id).expect(200);
    expect(response.body).toEqual({});
    expect((await notifications.findById(other.id))?.read).toBe(false);
  });

  it('uses current assignments after revocation despite old JWT claims', async () => {
    const own = await notice(fixture.admin, 'Previously allowed', {
      link: `/admin/appointment/details/${fixture.appointmentA}`,
    });
    expect((await get().expect(200)).body).toHaveLength(1);
    await users.updateOne({ _id: fixture.admin }, { $set: { clinics: [] } });
    expect((await get().expect(200)).body).toEqual([]);
    await read(own.id).expect(403);
  });

  it('treats explicit empty assignments as no access despite a legacy single clinic field', async () => {
    const own = await notice(fixture.unassignedAdmin, 'No assignment', {
      appointment: fixture.appointmentA,
    });
    expect((await get('unassigned').expect(200)).body).toEqual([]);
    await read(own.id, 'unassigned').expect(403);
  });

  it('hides historical notices when their appointment moves outside the assigned clinic', async () => {
    const own = await notice(fixture.admin, 'Moved appointment', {
      link: `/admin/appointment/details/${fixture.appointmentA}`,
    });
    await appointments.updateOne(
      { _id: fixture.appointmentA },
      { $set: { clinic: fixture.clinicB } },
    );
    expect((await get().expect(200)).body).toEqual([]);
    await read(own.id).expect(403);
  });

  it('preserves a super-admin global recipient inbox including unknown legacy notices', async () => {
    await notice(fixture.superAdmin, 'A', {
      appointment: fixture.appointmentA,
    });
    await notice(fixture.superAdmin, 'B', {
      appointment: fixture.appointmentB,
    });
    const unknown = await notice(fixture.superAdmin, 'Legacy unknown');
    expect(
      (await get('super').expect(200)).body
        .map((row: { message: string }) => row.message)
        .sort(),
    ).toEqual(['A', 'B', 'Legacy unknown']);
    await read(unknown.id, 'super').expect(200);
    expect((await notifications.findById(unknown.id))?.read).toBe(true);
  });

  it.each(['patient', 'dentist'])(
    'preserves the %s participant inbox across both clinics and legacy notices',
    async (token) => {
      const recipient = token === 'patient' ? fixture.patient : fixture.dentist;
      await notice(recipient, 'A', { appointment: fixture.appointmentA });
      const outside = await notice(recipient, 'B', {
        appointment: fixture.appointmentB,
      });
      await notice(recipient, 'Legacy participant', {
        link: '/app/my-appointment',
      });
      expect((await get(token).expect(200)).body).toHaveLength(3);
      await read(outside.id, token).expect(200);
      expect((await notifications.findById(outside.id))?.read).toBe(true);
    },
  );

  it('generates only clinic-assigned admin recipients plus all super-admins and saves appointment associations', async () => {
    const createdEvent = new Promise<Notification[]>((resolve) =>
      emitter.once('notifications.created', resolve),
    );
    const appointment = await appointments.findById(fixture.appointmentA);
    onChange({ operationType: 'insert', fullDocument: appointment });
    const created = await createdEvent;
    expect(created.map((row) => row.recipient.toString()).sort()).toEqual(
      [
        fixture.admin,
        fixture.superAdmin,
        fixture.patient,
        fixture.dentist,
      ].sort(),
    );
    const persisted = await notifications.find().lean();
    expect(
      persisted.map((row) =>
        (
          row as unknown as { appointment?: Types.ObjectId }
        ).appointment?.toString(),
      ),
    ).toEqual([
      fixture.appointmentA,
      fixture.appointmentA,
      fixture.appointmentA,
      fixture.appointmentA,
    ]);
  });

  it('saves associations for patient and dentist status update notices', async () => {
    await appointments.updateOne(
      { _id: fixture.appointmentB },
      { $set: { status: 'confirmed' } },
    );
    const createdEvent = new Promise<Notification[]>((resolve) =>
      emitter.once('notifications.created', resolve),
    );
    onChange({
      operationType: 'update',
      documentKey: { _id: new Types.ObjectId(fixture.appointmentB) },
      updateDescription: { updatedFields: { status: 'confirmed' } },
    });
    const created = await createdEvent;
    expect(created.map((row) => row.recipient.toString()).sort()).toEqual(
      [fixture.patient, fixture.dentist].sort(),
    );
    expect(
      (await notifications.find().lean()).map((row) =>
        (
          row as unknown as { appointment?: Types.ObjectId }
        ).appointment?.toString(),
      ),
    ).toEqual([fixture.appointmentB, fixture.appointmentB]);
  });

  it('delivers authorized realtime notices and denies outside and unknown admin payloads', async () => {
    await gateway.handleConnection(socket('admin'));
    const own = await notice(fixture.admin, 'A', {
      link: `/admin/appointment/details/${fixture.appointmentA}`,
    });
    const outside = await notice(fixture.admin, 'B', {
      link: `/admin/appointment/details/${fixture.appointmentB}`,
    });
    const unknown = await notice(fixture.admin, 'Unknown');
    await gateway.handleNotificationCreated(own);
    await gateway.handleNotificationsCreated([outside, unknown]);
    expect(sent.map((row) => row.payload.message)).toEqual(['A']);
  });

  it('rechecks persisted membership on realtime delivery after a connected admin loses access', async () => {
    await gateway.handleConnection(socket('admin'));
    const own = await notice(fixture.admin, 'Revoked', {
      link: `/admin/appointment/details/${fixture.appointmentA}`,
    });
    await users.updateOne({ _id: fixture.admin }, { $set: { clinics: [] } });
    await gateway.handleNotificationCreated(own);
    expect(sent).toHaveLength(0);
  });

  it('rechecks current role and denies old admin notices after demotion', async () => {
    await gateway.handleConnection(socket('admin'));
    const own = await notice(fixture.admin, 'Demoted', {
      link: `/admin/appointment/details/${fixture.appointmentA}`,
    });
    await users.updateOne({ _id: fixture.admin }, { $set: { role: 'user' } });
    await gateway.handleNotificationCreated(own);
    expect(sent).toHaveLength(0);
  });

  it('rejects OTP-pending sockets before receiving notification payloads', async () => {
    const client = socket('pending');
    await gateway.handleConnection(client);
    const own = await notice(fixture.patient, 'Patient identity', {
      appointment: fixture.appointmentA,
    });
    await gateway.handleNotificationCreated(own);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(sent).toHaveLength(0);
  });

  it('uses the current clinic boundary after a connected dentist becomes an admin', async () => {
    await gateway.handleConnection(socket('dentist'));
    const outside = await notice(
      fixture.dentist,
      'Former dentist Clinic B notice',
      {
        appointment: fixture.appointmentB,
        link: `/dentist/appointment/details/${fixture.appointmentB}`,
      },
    );
    await users.updateOne(
      { _id: fixture.dentist },
      { $set: { role: 'admin', clinics: [fixture.clinicA] } },
    );
    await gateway.handleNotificationCreated(outside);
    expect(sent).toHaveLength(0);
  });

  it.each(['patient', 'dentist', 'super'])(
    'preserves authorized %s realtime delivery',
    async (token) => {
      const recipient =
        token === 'patient'
          ? fixture.patient
          : token === 'dentist'
            ? fixture.dentist
            : fixture.superAdmin;
      await gateway.handleConnection(socket(token));
      const own = await notice(recipient, 'Allowed B', {
        appointment: fixture.appointmentB,
      });
      await gateway.handleNotificationCreated(own);
      expect(sent.map((row) => row.payload.message)).toEqual(['Allowed B']);
    },
  );
});
