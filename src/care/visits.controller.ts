import { Body, Controller, Get, Param, Patch, Post, Query, ValidationPipe } from '@nestjs/common';
import { User } from '../_shared/decorators/user.decorator';
import { UserActor } from '../auth/role-policy';
import { VisitsService } from './visits.service';
import { CheckInDto } from './dto/check-in.dto';
import { VisitQueryDto, VisitTransitionDto } from './dto/visit-transition.dto';

const careValidation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
@Controller('care')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}
  @Post('visits') checkIn(@User() actor: UserActor, @Body(careValidation) dto: CheckInDto) { return this.visits.checkIn(actor, dto); }
  @Get('visits') list(@User() actor: UserActor, @Query(careValidation) query: VisitQueryDto) { return this.visits.list(actor, query); }
  @Get('queue') queue(@User() actor: UserActor, @Query(careValidation) query: VisitQueryDto) { return this.visits.list(actor, query, true); }
  @Get('visits/:id') detail(@User() actor: UserActor, @Param('id') id: string) { return this.visits.findOne(actor, id); }
  @Patch('visits/:id/state') transition(@User() actor: UserActor, @Param('id') id: string, @Body(careValidation) dto: VisitTransitionDto) { return this.visits.transition(actor, id, dto); }
}
