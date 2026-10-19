import { BadRequestException } from '@nestjs/common';
import { calendarDay, timeMinutes } from './appointment-scheduling.rules';

export const ARRIVAL_GRACE_MINUTES = 20;

/** Stored dates are UTC calendar days; appointment clock times are Manila time. */
export function appointmentStart(date: Date, startTime: string): Date {
  const day = calendarDay(date);
  const minutes = timeMinutes(startTime);
  return new Date(day.getTime() + (minutes - 8 * 60) * 60_000);
}

export function reservationDeadline(date: Date, startTime: string): Date {
  const start = appointmentStart(date, startTime);
  if (!Number.isFinite(start.getTime())) throw new BadRequestException('Invalid appointment start');
  return new Date(start.getTime() + ARRIVAL_GRACE_MINUTES * 60_000);
}
