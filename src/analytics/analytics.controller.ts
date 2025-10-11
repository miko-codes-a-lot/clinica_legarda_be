import { Controller, Get, Param } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

// This is the model the Angular app expects for the weekly trend chart
interface WeeklyTrendResponse {
  labels: string[];
  appointments: number[];
  completed: number[];
}

// This is the model the Angular app expects for the summary cards and doughnut chart
interface WeeklySummaryResponse {
  weekOf: Date;
  totalAppointments: number;
  patientRecordsChanged: number; // Placeholder for Records Updated metric
  preferredServices: { [serviceName: string]: number };
}

// This is the model the Angular app expects for the daily queue
interface DailyQueueResponse {
  time: string;
  patientName: string;
  service: string;
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Endpoint for the Key Metrics (cards) and Preferred Services (doughnut chart).
   * @param clinicId The MongoDB ObjectId of the clinic.
   */
  @Get('summary/:clinicId')
  async getWeeklySummary(
    @Param('clinicId') clinicId: string,
  ): Promise<WeeklySummaryResponse> {
    return this.analyticsService.getWeeklySummary(clinicId);
  }

  /**
   * Endpoint for the Weekly Appointment Trend (line chart).
   * @param clinicId The MongoDB ObjectId of the clinic.
   */
  @Get('trend/:clinicId')
  async getWeeklyAppointmentTrend(
    @Param('clinicId') clinicId: string,
  ): Promise<WeeklyTrendResponse> {
    return this.analyticsService.getWeeklyAppointmentTrend(clinicId);
  }

  /**
   * Endpoint for the Daily Appointment Queue (table).
   * @param clinicId The MongoDB ObjectId of the clinic.
   */
  @Get('queue/:clinicId')
  async getDailyAppointmentQueue(
    @Param('clinicId') clinicId: string,
  ): Promise<DailyQueueResponse[]> {
    return this.analyticsService.getDailyAppointmentQueue(clinicId);
  }
}
