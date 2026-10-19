import { Body, Controller, Get, Param, Put, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { User } from '../_shared/decorators/user.decorator';
import { UserActor } from '../auth/role-policy';
import { DentalChartsService } from './dental-charts.service';
import { DentalChartQueryDto, DentalChartSaveDto } from './dental-charts.dto';
@Controller('dental-charts')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DentalChartsController {
  constructor(private readonly charts: DentalChartsService) {}
  @Get('clinics') clinics(@User() actor: UserActor) { return this.charts.clinicsFor(actor); }
  @Get(':patient') read(@User() actor: UserActor, @Param('patient') patient: string, @Query() query: DentalChartQueryDto) { return this.charts.read(actor, patient, query); }
  @Put(':patient') save(@User() actor: UserActor, @Param('patient') patient: string, @Body() dto: DentalChartSaveDto) { return this.charts.save(actor, patient, dto); }
}
