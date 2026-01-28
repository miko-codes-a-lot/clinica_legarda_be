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
  Query
} from '@nestjs/common';

import { ReasonService } from './reason.service';
import { ReasonUsage } from './entities/reason.entity';

import { ReasonUpsertDto } from './dto/reason-upsert.dto';


@Controller('reasons')
export class ReasonController {
  constructor(private readonly reasonService: ReasonService) {}

  @Post()
  create(@Body() dto: ReasonUpsertDto) {
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
  update(@Param('id') id: string, @Body() dto: ReasonUpsertDto) {
    return this.reasonService.update(id, dto);
  }

  @Patch(':id/toggle')
  toggle(@Param('id') id: string) {
    return this.reasonService.toggleActive(id);
  }
}
