import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ClinicsService } from './clinics.service';
import { ClinicUpsertDto } from './dto/clinic-upsert.dto';

@Controller('clinics')
export class ClinicsController {
  constructor(private readonly clinicsService: ClinicsService) {}

  @Post()
  create(@Body() doc: ClinicUpsertDto) {
    return this.clinicsService.upsert(doc);
  }
}
