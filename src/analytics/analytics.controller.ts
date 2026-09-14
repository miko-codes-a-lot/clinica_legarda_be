import { Controller, Get, Param } from '@nestjs/common';
import { User } from '../_shared/decorators/user.decorator';
import { UserActor } from '../auth/role-policy';
import { AnalyticsService } from './analytics.service';
import {
  DailyQueueResponse,
  WeeklySummaryResponse,
  WeeklyTrendResponse,
} from './report-responses';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary/:clinicId')
  getWeeklySummary(
    @Param('clinicId') clinicId: string,
    @User() actor: UserActor,
  ): Promise<WeeklySummaryResponse> {
    return this.analyticsService.getWeeklySummary(clinicId, actor);
  }

  @Get('trend/:clinicId')
  getWeeklyAppointmentTrend(
    @Param('clinicId') clinicId: string,
    @User() actor: UserActor,
  ): Promise<WeeklyTrendResponse> {
    return this.analyticsService.getWeeklyAppointmentTrend(clinicId, actor);
  }

  @Get('queue/:clinicId')
  getDailyAppointmentQueue(
    @Param('clinicId') clinicId: string,
    @User() actor: UserActor,
  ): Promise<DailyQueueResponse[]> {
    return this.analyticsService.getDailyAppointmentQueue(clinicId, actor);
  }
}
