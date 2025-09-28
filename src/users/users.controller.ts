import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from 'src/_shared/decorators/user.decorator';
import { UserDto } from 'src/auth/dto/user.dto';
import { UserUpsertDto } from './dto/user-upsert.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  profile(@User() user: UserDto) {
    return user;
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post()
  create(@Body() doc: UserUpsertDto) {
    return this.usersService.upsert(doc)
  }
}
