import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Model, model, deleteModel } from 'mongoose';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { Appointment } from '../appointments/entities/appointment.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { UserStatus } from '../_shared/enum/user-status.enum';
import { User, UserSchema } from './entities/user.entity';
import { UserActor } from '../auth/role-policy';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const dentistId = '64b000000000000000000001';
const clinicId = '64a000000000000000000001';
const UserModel = model('DentistApprovalTest', UserSchema);
const query = <T>(value: T) =>
  Object.assign(Promise.resolve(value), {
    populate: () => query(value),
  });

describe('Dentist approval permission and transition', () => {
  let app: INestApplication;
  let stored: InstanceType<typeof UserModel> | null;
  let update: jest.Mock;

  beforeAll(async () => {
    const userModel = {
      findById: () => query(stored),
      findOneAndUpdate: (
        filter: Record<string, unknown>,
        change: { $set: Record<string, unknown> },
      ) => {
        update(filter, change);
        if (
          !stored ||
          Object.entries(filter).some(
            ([key, value]) => key !== '$or' && stored?.[key as keyof typeof stored]?.toString() !== String(value),
          )
        )
          return query(null);
        Object.assign(stored, change.$set);
        return query(stored);
      },
    };
    const service = new UsersService(
      userModel as unknown as Model<User>,
      {} as Model<Clinic>,
      {} as Model<Appointment>,
    );
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: service },
        {
          provide: AuthService,
          useValue: {
            resolveActor: async (actor: UserActor) => actor,
            verifyJwt: async (token: string) => ({
              sub: dentistId,
              role: token, clinics: [clinicId],
            }),
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(() => {
    stored = new UserModel({
      _id: dentistId,
      role: 'dentist',
      status: UserStatus.PENDING,
      clinics: [clinicId],
    });
    update = jest.fn();
  });

  afterAll(async () => { await app?.close(); deleteModel('DentistApprovalTest'); });

  it.each(['admin', 'super-admin'])(
    'allows %s to approve a pending dentist without changing assignments or OTP verification',
    async (role) => {
      const response = await request(app.getHttpServer())
        .patch(`/api/users/${dentistId}/approve-dentist`)
        .set('Cookie', `jwt=${role}`)
        .send({ role: 'super-admin', clinics: [] })
        .expect(200);
      expect(response.body).toMatchObject({
        role: 'dentist',
        status: 'confirmed',
        clinics: [clinicId],
      });
      expect(response.body.otpVerifiedAt).toBeUndefined();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ _id: dentistId, role: 'dentist', status: UserStatus.PENDING }),
        { $set: { status: UserStatus.CONFIRMED } },
      );
    },
  );

  it.each(['dentist', 'user'])(
    'prevents %s from approving the dentist, including self approval',
    async (role) => {
      await request(app.getHttpServer())
        .patch(`/api/users/${dentistId}/approve-dentist`)
        .set('Cookie', `jwt=${role}`)
        .expect(403);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .patch(`/api/users/${dentistId}/approve-dentist`)
      .expect(401);
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['user', 'admin', 'super-admin'])(
    'does not approve a %s account through the dentist action',
    async (role) => {
      if (stored) stored.role = role;
      await request(app.getHttpServer())
        .patch(`/api/users/${dentistId}/approve-dentist`)
        .set('Cookie', 'jwt=admin')
        .expect(400);
      expect(stored?.status).toBe(UserStatus.PENDING);
    },
  );

  it.each([UserStatus.CONFIRMED, UserStatus.REJECTED])(
    'does not overwrite a dentist whose current status is %s',
    async (status) => {
      if (stored) stored.status = status;
      await request(app.getHttpServer())
        .patch(`/api/users/${dentistId}/approve-dentist`)
        .set('Cookie', 'jwt=admin')
        .expect(409);
      expect(stored?.status).toBe(status);
    },
  );

  it('returns not found for a missing dentist and rejects invalid IDs', async () => {
    stored = null;
    await request(app.getHttpServer())
      .patch(`/api/users/${dentistId}/approve-dentist`)
      .set('Cookie', 'jwt=admin')
      .expect(404);
    await request(app.getHttpServer())
      .patch('/api/users/not-an-id/approve-dentist')
      .set('Cookie', 'jwt=admin')
      .expect(400);
  });
});
