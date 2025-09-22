import { Controller, Get } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from 'src/_shared/decorators/user.decorator';
import { UserDto } from 'src/auth/dto/user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  profile(@User() user: UserDto) {
    return user;
  }
}
