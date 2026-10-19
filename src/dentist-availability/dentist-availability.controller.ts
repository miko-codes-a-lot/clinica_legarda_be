import { Body, Controller, Delete, Get, Param, Post, Put, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { User } from '../_shared/decorators/user.decorator';
import { Public } from '../auth/auth.guard';
import { UserActor } from '../auth/role-policy';
import { DentistAvailabilityService } from './dentist-availability.service';
import { DentistAvailabilityQueryDto, DentistDayAvailabilityDto } from './dto/dentist-day-availability.dto';

@Controller('dentist-availability')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DentistAvailabilityController {
  constructor(private readonly availability: DentistAvailabilityService) {}
  @Public() @Get(':dentistId/public') publicDays(@Param('dentistId') dentist: string, @Query() query: DentistAvailabilityQueryDto) { return this.availability.publicDays(dentist, query); }
  @Get(':dentistId') list(@User() actor: UserActor, @Param('dentistId') dentist: string, @Query() query: DentistAvailabilityQueryDto) { return this.availability.list(actor, dentist, query); }
  @Post(':dentistId/days/:date/preview') preview(@User() actor: UserActor, @Param('dentistId') dentist: string, @Param('date') date: string, @Body() dto: DentistDayAvailabilityDto) { return this.availability.preview(actor, dentist, date, dto); }
  @Put(':dentistId/days/:date') save(@User() actor: UserActor, @Param('dentistId') dentist: string, @Param('date') date: string, @Body() dto: DentistDayAvailabilityDto) { return this.availability.save(actor, dentist, date, dto); }
  @Delete(':dentistId/days/:date') restore(@User() actor: UserActor, @Param('dentistId') dentist: string, @Param('date') date: string, @Body() dto: DentistDayAvailabilityDto) { return this.availability.save(actor, dentist, date, { ...dto, restoreWeeklyHours: true }); }
}
