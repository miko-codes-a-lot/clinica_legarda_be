import { Appointment } from '../appointments/entities/appointment.entity';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import mongoose, { Model } from 'mongoose';
import { User, UserSchema } from './entities/user.entity';
import { UserUpsertDto } from './dto/user-upsert.dto';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UserStatus } from 'src/_shared/enum/user-status.enum';
import { Clinic } from 'src/clinics/entities/clinic.entity';

const clinicA = '64a000000000000000000001';
const clinicB = '64a000000000000000000002';
const dentistId = '64b000000000000000000001';
const admin = { sub: '64b000000000000000000002', role: 'admin' };
const dentist = { sub: dentistId, role: 'dentist' };
const UserModel = mongoose.model('MembershipWriteTest', UserSchema);
const form = (extra: Record<string, unknown> = {}): UserUpsertDto =>
  Object.assign(new UserUpsertDto(), {
    firstName: 'Jamie',
    lastName: 'Flores',
    username: 'jamie',
    emailAddress: 'jamie@example.test',
    mobileNumber: '09171112222',
    address: 'Manila',
    role: 'dentist',
    ...extra,
  });
const query = <T>(value: T) =>
  Object.assign(Promise.resolve(value), {
    populate: () => query(value),
    select: () => query(value),
  });

describe('User membership writes and profile authorization', () => {
  let stored: InstanceType<typeof UserModel>;
  let service: UsersService;
  let writes: number;

  beforeEach(() => {
    stored = new UserModel({
      ...form(),
      _id: dentistId,
      clinic: clinicA,
      status: UserStatus.CONFIRMED,
    });
    writes = 0;
    const userModel = {
      findOne: (filter: { _id?: string; $or?: unknown }) =>
        query(filter.$or ? null : stored),
      findById: () => query(stored),
      findOneAndUpdate: (
        _filter: unknown,
        update: {
          $set: Record<string, unknown>;
          $unset?: Record<string, unknown>;
        },
      ) => {
        writes++;
        stored.set(update.$set);
        for (const key of Object.keys(update.$unset || {}))
          stored.set(key, undefined);
        return query(stored);
      },
    };
    const clinicModel = {
      countDocuments: ({ _id }: { _id: { $in: string[] } }) =>
        query(_id.$in.filter((id) => [clinicA, clinicB].includes(id)).length),
    };
    service = new UsersService(
      userModel as unknown as Model<User>,
      clinicModel as unknown as Model<Clinic>,
      {} as Model<Appointment>,
    );
  });

  afterAll(() => mongoose.deleteModel('MembershipWriteTest'));

  const save = (
    service: UsersService,
    doc: UserUpsertDto,
    actor: typeof dentist | undefined = admin,
    id: string | undefined = dentistId,
  ) => service.upsert(doc, id, actor);

  it('persists two memberships, normalizes duplicates and retains the first legacy clinic', async () => {
    await save(service, form({ clinics: [clinicA, clinicB, clinicA] }));
    expect(stored.toObject()).toMatchObject({
      clinics: [
        new mongoose.Types.ObjectId(clinicA),
        new mongoose.Types.ObjectId(clinicB),
      ],
      clinic: new mongoose.Types.ObjectId(clinicA),
    });
  });

  it('persists revocation and clears the compatibility clinic', async () => {
    await save(service, form({ clinics: [] }));
    expect(
      (stored.toObject() as unknown as { clinics: unknown[] }).clinics,
    ).toEqual([]);
    expect(stored.clinic).toBeUndefined();
  });

  it.each(['not-an-id', '64a000000000000000000003'])(
    'rejects invalid or missing clinic %s before persistence',
    async (id) => {
      await expect(
        save(service, form({ clinics: [id] })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(writes).toBe(0);
    },
  );

  it.each([
    { role: 'super-admin' },
    { status: UserStatus.REJECTED },
    { clinics: [clinicA, clinicB] },
    { clinic: clinicB },
  ])('rejects a dentist changing privileged fields: %j', async (changes) => {
    await expect(save(service, form(changes), dentist)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(writes).toBe(0);
  });

  it('allows existing self-profile payloads but discards undeclared sensitive fields', async () => {
    await save(
      service,
      form({
        firstName: 'Updated',
        clinic: clinicA,
        status: UserStatus.CONFIRMED,
        otpVerifiedAt: new Date(),
        appointmentBufferMinutes: 0,
      }),
      dentist,
    );
    expect(stored.firstName).toBe('Updated');
    expect(stored.otpVerifiedAt).toBeUndefined();
    expect(stored.appointmentBufferMinutes).toBe(15);
  });

  it('rejects editing another user and unauthenticated service writes', async () => {
    await expect(
      save(service, form(), { ...dentist, sub: admin.sub }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.upsert(form())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(writes).toBe(0);
  });

  it('public registration cannot preserve injected assignments, status, roles or OTP fields', async () => {
    const controller = new UsersController(service);
    await controller.register(
      form({
        role: 'super-admin',
        status: UserStatus.CONFIRMED,
        clinics: [clinicA],
        clinic: clinicB,
        otpVerifiedAt: new Date(),
      }),
    );
    expect(stored.role).toBe('user');
    expect(stored.status).toBe(UserStatus.PENDING);
    expect(
      (stored.toObject() as unknown as { clinics: unknown[] }).clinics,
    ).toEqual([]);
    expect(stored.clinic).toBeUndefined();
    expect(stored.otpVerifiedAt).toBeUndefined();
  });
});

describe('User response contract', () => {
  it('does not serialize a password even when loaded for authentication', () => {
    const model = mongoose.model<User>('UserResponseTest', UserSchema);
    const user = new model({ password: 'stored-hash', resetOtp: '123456' });
    expect(JSON.parse(JSON.stringify(user))).not.toHaveProperty('password');
    expect(user.password).toBe('stored-hash');
    mongoose.deleteModel('UserResponseTest');
  });
});
