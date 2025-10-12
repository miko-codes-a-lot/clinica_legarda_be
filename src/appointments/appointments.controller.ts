import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  HttpCode,
  HttpStatus,
  Patch,
  Query
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentUpsertDto } from './dto/appointment-upsert.dto';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createAppointmentDto: AppointmentUpsertDto) {
    return this.appointmentsService.create(createAppointmentDto);
  }

  // @Get()
  // @HttpCode(HttpStatus.OK)
  // findAll() {
  //   return this.appointmentsService.findAll();
  // }

  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(@Query('patient') patient?: string) {
    return this.appointmentsService.findAll(patient);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id') id: string) {
    return this.appointmentsService.findOne(id);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id') id: string,
    @Body() updateAppointmentDto: AppointmentUpsertDto,
  ) {
    return this.appointmentsService.update(id, updateAppointmentDto);
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string) {
    return this.appointmentsService.approve(id);
  }

  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id') id: string) {
    return this.appointmentsService.reject(id);
  }
}
