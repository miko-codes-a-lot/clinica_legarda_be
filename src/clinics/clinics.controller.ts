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

@Controller('clinics')
export class ClinicsController {
  constructor(private readonly clinicsService: ClinicsService) {}

  @HttpCode(HttpStatus.OK)
  @Get()
  findAll() {
    return this.clinicsService.findAll();
  }

  @HttpCode(HttpStatus.OK)
  @Get(':id')
  findOne(@Param('id') id: string) {
    console.log('clinic id dapat: ', id);
    return this.clinicsService.findOne(id);
  }

  @HttpCode(HttpStatus.CREATED)
  @Post()
  create(@Body() doc: ClinicUpsertDto) {
    return this.clinicsService.upsert(doc);
  }

  @HttpCode(HttpStatus.OK)
  @Put(':id')
  update(@Param('id') id: string, @Body() doc: ClinicUpsertDto) {
    return this.clinicsService.upsert(doc, id);
  }
}
