import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from 'src/_shared/decorators/user.decorator';
import { UserDto } from 'src/auth/dto/user.dto';
import { UserUpsertDto } from './dto/user-upsert.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @HttpCode(HttpStatus.OK)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get('profile')
  profile(@User() user: UserDto) {
    return this.usersService.findByOneUsername(user.username);
  }

  @HttpCode(HttpStatus.OK)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post()
  create(@Body() doc: UserUpsertDto) {
    return this.usersService.upsert(doc);
  }

  @HttpCode(HttpStatus.OK)
  @Put(':id')
  update(@Param('id') id: string, doc: UserUpsertDto) {
    return this.usersService.upsert(doc, id);
  }
}
