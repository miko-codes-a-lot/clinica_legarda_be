import { Body, Controller, Get, Param, Patch, Post, Query, ValidationPipe } from '@nestjs/common';
import { User } from '../_shared/decorators/user.decorator';
import { UserActor } from '../auth/role-policy';
import { TreatmentCasesService } from './treatment-cases.service';
import { TreatmentCaseDto, TreatmentCaseQueryDto, TreatmentCaseStatusDto } from './dto/treatment-case.dto';
const validation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

@Controller('care/cases')
export class TreatmentCasesController {
  constructor(private readonly cases: TreatmentCasesService) {}
  @Post() create(@User() actor: UserActor, @Body(validation) dto: TreatmentCaseDto) { return this.cases.create(actor, dto); }
  @Get() list(@User() actor: UserActor, @Query(validation) query: TreatmentCaseQueryDto) { return this.cases.list(actor, query); }
  @Get(':id') detail(@User() actor: UserActor, @Param('id') id: string) { return this.cases.findOne(actor, id); }
  @Patch(':id') close(@User() actor: UserActor, @Param('id') id: string, @Body(validation) dto: TreatmentCaseStatusDto) { return this.cases.close(actor, id, dto); }
}
