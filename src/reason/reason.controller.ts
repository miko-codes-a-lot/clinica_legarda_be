import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Put,
  Patch,
  Query,
  ForbiddenException,
} from '@nestjs/common';

import { ReasonService } from './reason.service';
import { ReasonUsage } from './entities/reason.entity';

import { ReasonUpsertDto } from './dto/reason-upsert.dto';


import { User } from '../_shared/decorators/user.decorator';
import { UserDto } from '../auth/dto/user.dto';
import { isAdmin } from '../auth/role-policy';

@Controller('reasons')
export class ReasonController {
  constructor(private readonly reasonService: ReasonService) {}

  @Post()
  create(@Body() dto: ReasonUpsertDto, @User() actor: UserDto) {
    this.assertManagement(actor);
    return this.reasonService.create(dto);
  }

  @Get()
  findAll(@Query('usage') usage?: ReasonUsage) {
    return this.reasonService.findAll(usage);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reasonService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: ReasonUpsertDto, @User() actor: UserDto) {
    this.assertManagement(actor);
    return this.reasonService.update(id, dto);
  }

  @Patch(':id/toggle')
  toggle(@Param('id') id: string, @User() actor: UserDto) {
    this.assertManagement(actor);
    return this.reasonService.toggleActive(id);
  }

  private assertManagement(actor: UserDto): void {
    if (!isAdmin(actor)) throw new ForbiddenException('Only administrators may manage reasons.');
  }
}
