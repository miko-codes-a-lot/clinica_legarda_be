import { Controller, Get, Param, Query, ValidationPipe } from '@nestjs/common';
import { User } from '../_shared/decorators/user.decorator';
import { UserActor } from '../auth/role-policy';
import { PatientRecordsService } from './patient-records.service';
import { CareClinicQueryDto, PatientSearchDto } from './dto/patient-search.dto';

@Controller('care/patients')
export class PatientRecordsController {
  constructor(private readonly records: PatientRecordsService) {}
  @Get()
  search(@User() actor: UserActor, @Query(new ValidationPipe({ transform: true, whitelist: true })) query: PatientSearchDto) {
    return this.records.search(actor, query);
  }
  @Get(':id')
  detail(@User() actor: UserActor, @Param('id') id: string, @Query(new ValidationPipe({ transform: true, whitelist: true })) query: CareClinicQueryDto) {
    return this.records.findOne(actor, id, query.clinic);
  }
}
