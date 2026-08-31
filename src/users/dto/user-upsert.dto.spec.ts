import 'reflect-metadata';
import { validate } from 'class-validator';
import { UserUpsertDto } from './user-upsert.dto';

describe('UserUpsertDto', () => {
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
