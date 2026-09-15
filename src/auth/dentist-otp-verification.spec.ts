import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { Appointment } from '../appointments/entities/appointment.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { MailerService } from '../mailer/mailer.service';
import { OtpService } from '../otp/otp.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { UserStatus } from '../_shared/enum/user-status.enum';
import { AuthService } from './auth.service';

it('email OTP verification verifies login without approving the dentist for bookings', async () => {
  const stored = {
    _id: '64b000000000000000000001',
    username: 'test-dentist',
    role: 'dentist',
    status: UserStatus.PENDING,
    clinics: ['64a000000000000000000001'],
    otpVerifiedAt: undefined as Date | undefined,
  };
  const userModel = {
    findById: () => ({ populate: () => Promise.resolve(stored) }),
    findByIdAndUpdate: (
      _id: string,
      update: { $set: Record<string, unknown> },
    ) => {
      Object.assign(stored, update.$set);
      return Promise.resolve(stored);
    },
  };
  const users = new UsersService(
    userModel as unknown as Model<User>,
    {} as Model<Clinic>,
    {} as Model<Appointment>,
  );
  const verify = jest.fn().mockResolvedValue(undefined);
  const auth = new AuthService(
    {
      signAsync: jest.fn().mockResolvedValue('test-session-token'),
    } as unknown as JwtService,
    users,
    {
      verify,
      deleteForUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as OtpService,
    {} as MailerService,
  );

  const result = await auth.verifyOtp(stored._id, '123456');

  expect(verify).toHaveBeenCalledWith(stored._id, '123456');
  expect(stored.otpVerifiedAt).toBeInstanceOf(Date);
  expect(stored.status).toBe(UserStatus.PENDING);
  expect(stored.clinics).toEqual(['64a000000000000000000001']);
  expect(result.user.status).toBe(UserStatus.PENDING);
});
