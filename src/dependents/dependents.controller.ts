import { Body, Controller, Delete, Get, Param, Post, Put, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { User } from '../_shared/decorators/user.decorator';
import { UserActor } from '../auth/role-policy';
import { DependentUpsertDto, GuardianCandidateDto, LinkGuardianDto } from './dependents.dto';
import { DependentsService } from './dependents.service';
@Controller('dependents')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DependentsController {
  constructor(private readonly dependents: DependentsService) {}
  @Get() list(@User() actor: UserActor) { return this.dependents.list(actor); }
  @Post() create(@User() actor: UserActor, @Body() dto: DependentUpsertDto) { return this.dependents.create(actor, dto); }
  @Post(':id/guardian-candidate') candidate(@User() actor: UserActor, @Param('id') id: string, @Body() dto: GuardianCandidateDto) { return this.dependents.guardianCandidate(actor, id, dto.emailAddress); }
  @Put(':id') update(@User() actor: UserActor, @Param('id') id: string, @Body() dto: DependentUpsertDto) { return this.dependents.update(actor, id, dto); }
  @Delete(':id/guardian') unlink(@User() actor: UserActor, @Param('id') id: string, @Query('expectedGuardian') expectedGuardian?: string) { return this.dependents.unlink(actor, id, expectedGuardian); }
  @Put(':id/guardian') link(@User() actor: UserActor, @Param('id') id: string, @Body() dto: LinkGuardianDto) { return this.dependents.link(actor, id, dto); }
}
