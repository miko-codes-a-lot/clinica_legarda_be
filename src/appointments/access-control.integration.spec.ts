import { clinicReferenceId } from '../users/clinic-membership';
import { ReferralsService } from '../referral/referrals.service';
import { ClinicsService } from '../clinics/clinics.service';
import { AppointmentStatus } from '../_shared/enum/appointment-status.enum';
import { ProfilePictureGuard } from '../users/profile-picture.guard';
import { existsSync, readdirSync } from 'fs';
import {
  INestApplication,
  ValidationPipe,
  ForbiddenException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Connection, createConnection, Model } from 'mongoose';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
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
import { UsersService } from '../users/users.service';
import { UsersController } from '../users/users.controller';

const uri = process.env.TEST_MONGO_URI;
const localTests = uri ? describe : describe.skip;
localTests('Record access boundaries', () => {
  let connection: Connection;
  let app: INestApplication;
  let appointments: Model<Appointment>;
  let users: Model<User>;
  let clinics: Model<Clinic>;
  let referrals: Model<Referral>;
  let service: AppointmentsService;
  let userService: UsersService;
  let referralService: ReferralsService;
  let fixture: {
    patient: string;
    otherPatient: string;
    dentist: string;
    otherDentist: string;
    clinic: string;
    otherClinic: string;
    appointment: string;
    otherAppointment: string;
  };
  const hours = [{ day: 'monday', startTime: '08:00', endTime: '18:00' }];
  const date = new Date('2026-09-21');
  const admin = { sub: '64b000000000000000000099', role: 'admin' };
  const actor = (role: 'user' | 'dentist', other = false) => ({
    sub:
      role === 'user'
        ? other
          ? fixture.otherPatient
          : fixture.patient
        : other
          ? fixture.otherDentist
          : fixture.dentist,
    role,
  });
  beforeAll(async () => {
    if (
      uri !==
      'mongodb://127.0.0.1:27028/clinica_test_ticket05?replicaSet=clinica-test'
    )
      throw new Error('Use only the isolated Ticket05 database.');
    connection = await createConnection(uri).asPromise();
    appointments = connection.model(Appointment.name, AppointmentSchema);
    users = connection.model(User.name, UserSchema);
    clinics = connection.model(Clinic.name, ClinicSchema);
    referrals = connection.model(Referral.name, ReferralSchema);
    const catalog = connection.model(DentalCatalog.name, DentalCatalogSchema);
    service = new AppointmentsService(
      appointments,
      new AppointmentSchedulingService(appointments, users, clinics, catalog),
      referrals,
    );
    userService = new UsersService(users, clinics, appointments);
    referralService = new ReferralsService(referrals, appointments, service);
    const module = await Test.createTestingModule({
      controllers: [AppointmentsController, UsersController],
      providers: [
        ProfilePictureGuard,
        { provide: AppointmentsService, useValue: service },
        { provide: UsersService, useValue: userService },
        {
          provide: AuthService,
          useValue: {
            verifyJwt: async (token: string) => {
              if (token === 'patient') return actor('user');
              if (token === 'dentist') return actor('dentist');
              if (token === 'admin') return admin;
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
    const places = await clinics.create([
      { name: 'Access A', operatingHours: hours },
      { name: 'Access B', operatingHours: hours },
    ]);
    const people = await users.create([
      { role: 'user', firstName: 'Own', emailAddress: 'own@example.test' },
      { role: 'user', firstName: 'Other', emailAddress: 'other@example.test' },
      {
        role: 'dentist',
        firstName: 'Doctor',
        emailAddress: 'private@example.test',
        status: 'confirmed',
        clinics: places.map((c) => c._id),
        operatingHours: hours,
      },
      {
        role: 'dentist',
        firstName: 'Other Doctor',
        status: 'confirmed',
        clinics: places.map((c) => c._id),
        operatingHours: hours,
      },
    ]);
    const records = await appointments.create([
      {
        patient: people[0]._id,
        dentist: people[2]._id,
        clinic: places[0]._id,
        date,
        startTime: '09:00',
        endTime: '10:00',
        notes: { clinicNotes: 'Own confidential' },
      },
      {
        patient: people[1]._id,
        dentist: people[3]._id,
        clinic: places[0]._id,
        date,
        startTime: '11:00',
        endTime: '12:00',
        notes: { clinicNotes: 'Other confidential' },
      },
    ]);
    fixture = {
      patient: people[0].id,
      otherPatient: people[1].id,
      dentist: people[2].id,
      otherDentist: people[3].id,
      clinic: places[0].id,
      otherClinic: places[1].id,
      appointment: records[0].id,
      otherAppointment: records[1].id,
    };
  });
  afterAll(async () => {
    await app?.close();
    await connection?.close();
  });

  it('requires authentication and rejects a forged detail ID at the real guard boundary', async () => {
    await request(app.getHttpServer())
      .get(`/appointments/${fixture.appointment}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/appointments/${fixture.otherAppointment}`)
      .set('Cookie', 'jwt=patient')
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/appointments/${fixture.otherAppointment}/cancel`)
      .set('Cookie', 'jwt=patient')
      .send({ reason: 'Forged target' })
      .expect(403);
    expect(
      (await appointments.findById(fixture.otherAppointment))?.status,
    ).toBe('pending');
  });

  it('denies the global directory to patients at the real guard boundary', async () => {
    await request(app.getHttpServer())
      .get('/users')
      .set('Cookie', 'jwt=patient')
      .expect(403);
  });

  const booking = (extra: Record<string, unknown> = {}) => ({
    clinic: fixture.clinic,
    patient: fixture.patient,
    dentist: fixture.dentist,
    date,
    startTime: '14:00',
    endTime: '15:00',
    ...extra,
  });
  const source = (extra: Record<string, unknown> = {}) => ({
    fromDoctorId: fixture.dentist,
    fromClinicId: fixture.clinic,
    reason: 'Patient request',
    ...extra,
  });

  it('rejects unauthorized multipart upload before any file is written', async () => {
    const files = () =>
      existsSync('uploads/profile-pictures')
        ? readdirSync('uploads/profile-pictures').sort()
        : [];
    const before = files();
    await request(app.getHttpServer())
      .put(`/users/${fixture.otherPatient}/pictures`)
      .set('Cookie', 'jwt=patient')
      .attach('file', Buffer.from('fixture image'), 'test.png')
      .expect(403);
    expect(files()).toEqual(before);
    expect(
      (await users.findById(fixture.otherPatient))?.profilePicture,
    ).toBeUndefined();
  });

  it.each(['user', 'dentist'] as const)(
    'intersects every list filter with %s ownership',
    async (role) => {
      const own = actor(role);
      expect((await service.findAll(own)).map((record) => record.id)).toEqual([
        fixture.appointment,
      ]);
      expect(
        await service.findAll(own, fixture.otherPatient, fixture.clinic),
      ).toEqual([]);
      expect(
        await service.findAllByDentist(
          own,
          fixture.otherDentist,
          fixture.clinic,
        ),
      ).toEqual([]);
      expect(
        (await service.findAll(own, undefined, fixture.clinic)).map(
          (record) => record.id,
        ),
      ).toEqual([fixture.appointment]);
      expect((await service.findAll(admin)).length).toBe(2);
    },
  );

  it.each([
    'update',
    'approve',
    'reject',
    'cancel',
    'reschedule',
    'notes',
  ] as const)(
    'rejects cross-dentist %s using stored ownership',
    async (action) => {
      const target = fixture.otherAppointment;
      const calls = {
        update: () => service.update(target, booking(), actor('dentist')),
        approve: () => service.approve(target, actor('dentist')),
        reject: () => service.reject(target, actor('dentist')),
        cancel: () => service.cancel(target, actor('dentist')),
        reschedule: () =>
          service.reschedule(target, booking(), actor('dentist')),
        notes: () =>
          service.updateDentistNotes(target, 'Forged notes', actor('dentist')),
      };
      await expect(calls[action]()).rejects.toBeInstanceOf(ForbiddenException);
      expect((await appointments.findById(target))?.history).toHaveLength(0);
    },
  );

  it('allows only staff or the owning dentist to approve, reject, or write clinical notes', async () => {
    await expect(
      service.approve(fixture.appointment, actor('user')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.reject(fixture.appointment, actor('user')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateDentistNotes(fixture.appointment, 'Forged', actor('user')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await service.approve(fixture.appointment, actor('dentist'));
    const updated = await service.updateDentistNotes(
      fixture.appointment,
      'Authorized notes',
      admin,
    );
    expect(updated.status).toBe('confirmed');
    expect(updated.notes.clinicNotes).toBe('Authorized notes');
  });

  it('accepts equivalent uppercase actor and identity IDs without exposing another record', async () => {
    const own = { ...actor('user'), sub: fixture.patient.toUpperCase() };
    expect(
      (await service.findOne(fixture.appointment.toUpperCase(), own)).id,
    ).toBe(fixture.appointment);
    const result = await service.update(
      fixture.appointment,
      booking({
        patient: fixture.patient.toUpperCase(),
        dentist: fixture.dentist.toUpperCase(),
        clinic: fixture.clinic.toUpperCase(),
      }),
      own,
    );
    expect(result.patient._id.toString()).toBe(fixture.patient);
  });

  it.each(['patient', 'dentist', 'clinic'] as const)(
    'prevents nonstaff reassignment of %s and permits staff corrections',
    async (field) => {
      const replacements = {
        patient: fixture.otherPatient,
        dentist: fixture.otherDentist,
        clinic: fixture.otherClinic,
      };
      await expect(
        service.update(
          fixture.appointment,
          booking({ [field]: replacements[field] }),
          actor('dentist'),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const updated = await service.update(
        fixture.appointment,
        booking({ [field]: replacements[field] }),
        admin,
      );
      expect(clinicReferenceId(updated[field])).toBe(replacements[field]);
    },
  );

  it('derives patient ownership and blocks creation used to mint a dentist-patient relationship', async () => {
    await expect(
      service.create(booking({ patient: fixture.otherPatient }), actor('user')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.create(
        booking({ patient: fixture.otherPatient }),
        actor('dentist'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const created = await service.create(booking(), actor('dentist'));
    expect(created.patient._id.toString()).toBe(fixture.patient);
  });

  it('discards forged status/history/clinical notes while preserving existing clinical records on patient edits', async () => {
    const forged = booking({
      status: AppointmentStatus.COMPLETED,
      history: [{ action: 'Forged' }],
      notes: { patientNotes: 'My note', clinicNotes: 'Forged' },
    });
    const created = await service.create(forged, actor('user'));
    expect(created.status).toBe('pending');
    expect(created.notes).toMatchObject({
      patientNotes: 'My note',
      clinicNotes: '',
    });
    expect(created.history.map((entry) => entry.action)).toEqual([
      'Appointment created.',
    ]);
    await service.updateDentistNotes(
      created.id,
      'Preserve chart',
      actor('dentist'),
    );
    const updated = await service.update(created.id, forged, actor('user'));
    expect(updated.status).toBe('pending');
    expect(updated.notes.clinicNotes).toBe('Preserve chart');
    expect(updated.history.some((entry) => entry.action === 'Forged')).toBe(
      false,
    );
  });

  it('retains historical ownership but applies revoked membership to the next booking with the same actor', async () => {
    const dentist = actor('dentist');
    await users.updateOne({ _id: dentist.sub }, { $set: { clinics: [] } });
    expect((await service.findAll(dentist)).length).toBe(1);
    await expect(service.create(booking(), dentist)).rejects.toThrow(
      'not assigned',
    );
  });

  it('exposes safe discovery fields through directories and clinic details while restricting profiles', async () => {
    await users.create({
      role: 'dentist',
      status: 'pending',
      clinics: [fixture.clinic],
    });
    const directory = await userService.dentistDirectory(actor('user'));
    expect(directory).toHaveLength(2);
    const clinic = await new ClinicsService(clinics, users).findOne(
      fixture.clinic,
    );
    expect(clinic.dentists).toHaveLength(2);
    for (const dentist of [...directory, ...clinic.dentists]) {
      expect(dentist.toObject()).toHaveProperty('operatingHours');
      expect(dentist.toObject()).not.toHaveProperty('emailAddress');
      expect(dentist.toObject()).not.toHaveProperty('otpVerifiedAt');
    }
    expect(
      (await userService.patientDirectory(actor('dentist'))).map(
        (person) => person.id,
      ),
    ).toEqual([fixture.patient]);
    expect(await userService.patientDirectory(admin)).toHaveLength(2);
    await expect(
      userService.patientDirectory(actor('user')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      userService.findOne(fixture.otherPatient, actor('dentist')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      userService.findOne(fixture.dentist, actor('user')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (await userService.findOne(fixture.patient, actor('dentist')))
        .emailAddress,
    ).toBe('own@example.test');
    expect(
      (
        await userService.pictureProfile(fixture.dentist, actor('user'))
      )._id.toString(),
    ).toBe(fixture.dentist);
    await expect(
      userService.pictureProfile(fixture.otherPatient, actor('user')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns dentist scheduling fields on authorized appointment reads without personal contact fields', async () => {
    const record = await service.findOne(fixture.appointment, actor('user'));
    expect(record.dentist.clinics).toHaveLength(2);
    expect(record.dentist.operatingHours).toHaveLength(1);
    expect(record.dentist.appointmentBufferMinutes).toBe(15);
    expect(record.dentist.maxWorkingMinutesPerDay).toBe(480);
    expect(record.dentist.emailAddress).toBeUndefined();
    expect(record.patient.emailAddress).toBeUndefined();
  });

  it('prevents picture and delete privilege bypasses and provides narrow internal staff recipients', async () => {
    const superAdmin = await users.create({ role: 'super-admin' });
    await expect(
      userService.updateProfilePicture(
        fixture.otherPatient,
        'forged.png',
        actor('user'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      userService.updateProfilePicture(superAdmin.id, 'forged.png', admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      userService.delete(fixture.otherPatient, actor('dentist')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const recipients = await userService.notificationStaffRecipients();
    expect(
      recipients.map((recipient) => Object.keys(recipient.toObject()).sort()),
    ).toEqual([['_id', 'role']]);
  });

  it('validates referral source against patient history and derives patient despite forged context', async () => {
    await expect(
      referralService.upsert(
        source({ fromDoctorId: fixture.otherDentist }),
        undefined,
        actor('user'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      referralService.upsert(
        source({ fromClinicId: fixture.otherClinic }),
        undefined,
        actor('user'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      referralService.upsert(
        source({ patient: fixture.otherPatient }),
        undefined,
        actor('dentist'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const created = await referralService.upsert(
      source({
        patient: fixture.otherPatient,
        status: 'confirmed',
        appointment: fixture.otherAppointment,
      }),
      undefined,
      actor('user'),
    );
    expect(created.appointment).toBeNull();
    expect(created.status).toBe('pending');
    const saved = await referrals.findById(created._id);
    expect(saved?.patient?.toString()).toBe(fixture.patient);
    expect(saved?.createdBy?.toString()).toBe(fixture.patient);
    expect(saved?.appointment).toBeUndefined();
    await expect(
      referralService.findOne(created._id.toString(), actor('user', true)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows authorized intermediate referral linking but rejects forged, reused, and legacy-unowned links', async () => {
    const created = await referralService.upsert(
      source(),
      undefined,
      actor('user'),
    );
    const referral = created._id.toString();
    await expect(
      service.create(
        booking({ patient: fixture.otherPatient, referral }),
        actor('user', true),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const linked = await service.create(booking({ referral }), actor('user'));
    expect(linked.referral?._id.toString()).toBe(referral);
    await expect(
      service.create(
        booking({ referral, startTime: '16:00', endTime: '17:00' }),
        actor('user'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const legacy = await referrals.create(source());
    await expect(
      service.create(
        booking({ referral: legacy.id, startTime: '16:00', endTime: '17:00' }),
        actor('user'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('authorizes legacy linked referral context without revealing unrelated chart details and awaits rejection', async () => {
    const expectTimestamps = <T extends object>(record: T) => {
      const createdAt: unknown = Reflect.get(record, 'createdAt');
      const updatedAt: unknown = Reflect.get(record, 'updatedAt');
      expect(createdAt).toBeInstanceOf(Date);
      expect(updatedAt).toBeInstanceOf(Date);
      return record as T & { createdAt: Date; updatedAt: Date };
    };
    const referral = await referrals.create(source());
    const receiving = await appointments.create({
      ...booking({ dentist: fixture.otherDentist }),
      referral: referral._id,
      notes: {
        patientNotes: 'Relevant',
        clinicNotes: 'Private receiving chart',
      },
      history: [{ action: 'Private history' }],
    });
    const result = expectTimestamps(
      await referralService.findOne(referral.id, actor('dentist')),
    );
    expect(result.appointment?.patient._id.toString()).toBe(fixture.patient);
    expect(result.appointment?.notes.patientNotes).toBe('Relevant');
    expect(result.appointment?.notes.clinicNotes).toBeUndefined();
    expect(result.appointment?.history).toBeUndefined();
    await expect(
      service.findOne(receiving.id, actor('dentist')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const listed = await referralService.findAll(actor('dentist', true));
    expect(listed.map((record) => record._id.toString())).toEqual([
      referral.id,
    ]);
    const listedReferral = expectTimestamps(listed[0]);
    expect(listedReferral.createdAt).toEqual(result.createdAt);
    expect(listedReferral.updatedAt).toEqual(result.updatedAt);
    expect(
      (
        await referralService.findAllByDentist(
          actor('dentist', true),
          fixture.otherDentist,
        )
      ).map((record) => record._id.toString()),
    ).toEqual([referral.id]);
    expect(
      (
        await referralService.findOne(referral.id, actor('user'))
      )._id.toString(),
    ).toBe(referral.id);
    await expect(
      referralService.approve(referral.id, actor('user')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      referralService.findOne(referral.id, actor('user', true)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const rejected = expectTimestamps(
      await referralService.reject(
        'Source declined',
        referral.id,
        actor('dentist'),
      ),
    );
    expect(rejected.status).toBe('rejected');
    expect(rejected.createdAt).toEqual(result.createdAt);
    expect(rejected.updatedAt.getTime()).toBeGreaterThanOrEqual(
      result.updatedAt.getTime(),
    );
    expect((await appointments.findById(receiving.id))?.status).toBe(
      'rejected',
    );
  });

  it('rolls back the linked appointment if referral outcome persistence fails', async () => {
    const referral = await referrals.create(source());
    const receiving = await appointments.create({
      ...booking({ dentist: fixture.otherDentist }),
      referral: referral._id,
    });
    const write = jest
      .spyOn(referrals, 'findByIdAndUpdate')
      .mockImplementationOnce(() => {
        throw new Error('Injected referral write failure');
      });
    try {
      await expect(
        referralService.reject('Declined', referral.id, actor('dentist')),
      ).rejects.toThrow('Injected referral write failure');
      expect((await appointments.findById(receiving.id))?.status).toBe(
        'pending',
      );
      expect((await referrals.findById(referral.id))?.status).toBe('pending');
    } finally {
      write.mockRestore();
    }
  });

  it('rejects unlinked referrals without a receiving appointment and prevents subsequent linking', async () => {
    const created = await referralService.upsert(
      source(),
      undefined,
      actor('user'),
    );
    const result = await referralService.reject(
      'Declined',
      created._id.toString(),
      actor('dentist'),
    );
    expect(result.status).toBe('rejected');
    expect(result.appointment).toBeNull();
    await expect(
      service.create(
        booking({ referral: created._id.toString() }),
        actor('user'),
      ),
    ).rejects.toThrow('Rejected referrals cannot be linked');
  });
});
