import { Controller, Get, Query } from '@nestjs/common';
import { User } from '../_shared/decorators/user.decorator';
import { UserActor } from '../auth/role-policy';
import { PatientCareService } from './patient-care.service';
@Controller('care')
export class PatientCareController {
  constructor(private readonly care: PatientCareService) {}
  @Get('my-record') own(@User() actor: UserActor, @Query('patient') patient?: string) { return this.care.ownRecord(actor, patient); }
}
