import 'reflect-metadata';
import { validate } from 'class-validator';
import { UserUpsertDto } from './user-upsert.dto';

describe('UserUpsertDto', () => {
  const createDto = (password?: string) =>
    Object.assign(new UserUpsertDto(), {
      firstName: 'Ana',
      lastName: 'Cruz',
      username: 'ana.cruz',
      emailAddress: 'ana.cruz@example.test',
      mobileNumber: '+639171112101',
      address: 'Sampaloc, Manila',
      role: 'dentist',
      ...(password !== undefined && { password }),
    });

  it.each([
    ['fewer than 8 characters', 'Pass1!'],
    ['no uppercase letter', 'password1!'],
    ['no lowercase letter', 'PASSWORD1!'],
    ['no number', 'Password!'],
    ['no special character', 'Password1'],
  ])('rejects a password with %s', async (_reason, password) => {
    const errors = await validate(createDto(password));

    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });

  it('accepts a password that satisfies every strength requirement', async () => {
    const errors = await validate(createDto('Password1!'));

    expect(errors.some((error) => error.property === 'password')).toBe(false);
  });

  it('allows updates that omit the password', async () => {
    const errors = await validate(createDto());

    expect(errors.some((error) => error.property === 'password')).toBe(false);
  });

  it('rejects an unsupported user status', async () => {
    const dto = Object.assign(new UserUpsertDto(), {
      firstName: 'Ana',
      lastName: 'Cruz',
      username: 'ana.cruz',
      emailAddress: 'ana.cruz@example.test',
      mobileNumber: '+639171112101',
      address: 'Sampaloc, Manila',
      role: 'dentist',
      status: 'active',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'status')).toBe(true);
  });
});
