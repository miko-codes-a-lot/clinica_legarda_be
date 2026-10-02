import { Public } from '../auth/auth.guard';
import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { User } from '../_shared/decorators/user.decorator';
import { UserActor } from '../auth/role-policy';
import { ClinicClosuresService } from './clinic-closures.service';
import { ClinicClosureDto, ClosureAvailabilityDto, ClosureQueryDto, ReopenClosureDto } from './dto/clinic-closure.dto';
@Controller()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ClinicClosuresController {
  constructor(private readonly closures: ClinicClosuresService) {}
  @Public()
  @Get('clinic-closures/availability') availability(@Query() query: ClosureAvailabilityDto) { return this.closures.availability(query.clinic); }
  @Get('clinic-closures') list(@User() actor: UserActor, @Query() query: ClosureQueryDto) { return this.closures.list(actor, query.clinic); }
  @Post('clinic-closures/preview') preview(@User() actor: UserActor, @Body() dto: ClinicClosureDto) { return this.closures.preview(actor, dto); }
  @Post('clinic-closures') create(@User() actor: UserActor, @Body() dto: ClinicClosureDto) { return this.closures.create(actor, dto); }
  @Get('clinic-closures/:id') detail(@User() actor: UserActor, @Param('id') id: string) { return this.closures.findOne(actor, id); }
  @Patch('clinic-closures/:id/reopen') reopen(@User() actor: UserActor, @Param('id') id: string, @Body() dto: ReopenClosureDto) { return this.closures.reopen(actor, id, dto.reason); }
  @Patch('appointments/:id/clear-disruption') clear(@User() actor: UserActor, @Param('id') id: string, @Body() dto: ReopenClosureDto) { return this.closures.clearDisruption(actor, id, dto.reason); }
}
