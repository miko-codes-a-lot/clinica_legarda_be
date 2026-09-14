import 'reflect-metadata';
import { UserStatus } from 'src/_shared/enum/user-status.enum';
import { UserUpsertDto } from './dto/user-upsert.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  it('routes public registration through the restricted patient write path', async () => {
    const registerPatient = jest
      .fn()
      .mockResolvedValue({ role: 'user', status: UserStatus.PENDING });
    const usersService = { registerPatient } as unknown as UsersService;
    const controller = new UsersController(usersService);
    const registration = Object.assign(new UserUpsertDto(), {
      firstName: 'Jamie',
      lastName: 'Flores',
      username: 'jamie.flores',
      emailAddress: 'jamie.flores@example.test',
      mobileNumber: '+639171113002',
      address: 'Sampaloc, Manila',
      role: 'super-admin',
      status: UserStatus.CONFIRMED,
    });

    const registered = await controller.register(registration);

    expect(registerPatient).toHaveBeenCalledWith(registration);
    expect(registered).toMatchObject({
      role: 'user',
      status: UserStatus.PENDING,
    });
  });
});
