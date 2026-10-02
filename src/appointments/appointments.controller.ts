import { User } from '../_shared/decorators/user.decorator';
import { UserActor } from '../auth/role-policy';
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
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentUpsertDto } from './dto/appointment-upsert.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { RejectAppointmentDto } from './dto/reject-appointment.dto';
import { AppointmentChangeReasonDto } from './dto/appointment-change-reason.dto';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ValidationPipe({ transform: true }))
    createAppointmentDto: AppointmentUpsertDto,
    @User() actor: UserActor,
  ) {
    return this.appointmentsService.create(createAppointmentDto, actor);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(
    @User() actor: UserActor,
    @Query('patient') patient?: string,
    @Query('clinic') clinic?: string,
  ) {
    return this.appointmentsService.findAll(actor, patient, clinic);
  }

  @Get('by-dentist/:dentistId')
  @HttpCode(HttpStatus.OK)
  findAllByDentist(
    @Param('dentistId') dentistId: string,
    @User() actor: UserActor,
    @Query('clinic') clinic?: string,
  ) {
    return this.appointmentsService.findAllByDentist(actor, dentistId, clinic);
  }

  @Get('availability/:dentistId')
  availability(@Param('dentistId') dentistId: string, @User() actor: UserActor) {
    return this.appointmentsService.availability(dentistId, actor);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id') id: string, @User() actor: UserActor) {
    return this.appointmentsService.findOne(id, actor);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true }))
    updateAppointmentDto: AppointmentUpsertDto,
    @User() actor: UserActor,
  ) {
    return this.appointmentsService.update(id, updateAppointmentDto, actor);
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string, @User() actor: UserActor) {
    return this.appointmentsService.approve(id, actor);
  }

  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body(new ValidationPipe()) dto: RejectAppointmentDto,
    @User() actor: UserActor,
  ) {
    return this.appointmentsService.reject(id, actor, dto.reason);
  }

  @Patch(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@Param('id') id: string, @User() actor: UserActor) {
    return this.appointmentsService.complete(id, actor);
  }

  @Patch(':id/no-show')
  @HttpCode(HttpStatus.OK)
  noShow(@Param('id') id: string, @User() actor: UserActor) {
    return this.appointmentsService.noShow(id, actor);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id') id: string,
    @Body() dto: AppointmentChangeReasonDto,
    @User() actor: UserActor,
  ) {
    return this.appointmentsService.cancel(id, actor, dto.reason);
  }

  @Patch(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  reschedule(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true }))
    rescheduleDto: RescheduleAppointmentDto,
    @User() actor: UserActor,
  ) {
    return this.appointmentsService.reschedule(id, rescheduleDto, actor);
  }

  @Patch(':id/notes')
  @HttpCode(HttpStatus.OK)
  updateDentistNotes(
    @Param('id') id: string,
    @Body('clinicNotes') clinicNotes: string,
    @User() actor: UserActor,
  ) {
    return this.appointmentsService.updateDentistNotes(id, clinicNotes, actor);
  }
}
