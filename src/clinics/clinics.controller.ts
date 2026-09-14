import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Put,
} from '@nestjs/common';
import { ClinicsService } from './clinics.service';
import { ClinicUpsertDto } from './dto/clinic-upsert.dto';

import { Public } from '../auth/auth.guard';
import { User } from '../_shared/decorators/user.decorator';
import { UserDto } from '../auth/dto/user.dto';

@Controller('clinics')
export class ClinicsController {
  constructor(private readonly clinicsService: ClinicsService) {}

  @Public()
  @Get()
  findAll() {
    return this.clinicsService.findAll();
  }

  @HttpCode(HttpStatus.OK)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clinicsService.findOne(id);
  }

  @HttpCode(HttpStatus.CREATED)
  @Post()
  create(@Body() doc: ClinicUpsertDto, @User() actor: UserDto) {
    return this.clinicsService.upsert(doc, undefined, actor);
  }

  @HttpCode(HttpStatus.OK)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() doc: ClinicUpsertDto,
    @User() actor: UserDto,
  ) {
    return this.clinicsService.upsert(doc, id, actor);
  }
}
