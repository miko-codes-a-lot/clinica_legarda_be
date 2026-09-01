import 'reflect-metadata';
import { validate } from 'class-validator';
import { ResetPasswordOtpDto } from './auth-reset-otp.dto';

describe('ResetPasswordOtpDto', () => {
  const createDto = (newPassword: string) =>
    Object.assign(new ResetPasswordOtpDto(), {
      emailAddress: 'patient@example.test',
      newPassword,
    });

  it.each([
    ['fewer than 8 characters', 'Pass1!'],
    ['no uppercase letter', 'password1!'],
    ['no lowercase letter', 'PASSWORD1!'],
    ['no number', 'Password!'],
    ['no special character', 'Password1'],
  ])('rejects a new password with %s', async (_reason, newPassword) => {
    const errors = await validate(createDto(newPassword));

    expect(errors.some((error) => error.property === 'newPassword')).toBe(true);
  });

  it('accepts a new password that satisfies every strength requirement', async () => {
    const errors = await validate(createDto('Password1!'));

    expect(errors.some((error) => error.property === 'newPassword')).toBe(
      false,
    );
  });
});
