import { BadRequestException } from '@nestjs/common';
import { OperatingHour } from '../_shared/entities/operating-hour';
import { assignedClinicIds, ClinicMembership } from '../users/clinic-membership';

export interface ScheduleRequest {
  dentist: string;
  patient: string;
  clinic: string;
  date: Date;
  startTime: string;
  endTime: string;
  services: string[];
}

export interface ScheduleDentist extends ClinicMembership {
  role: string;
  status: string;
  operatingHours?: OperatingHour[];
  appointmentBufferMinutes: number;
  maxWorkingMinutesPerDay: number;
}

export interface OccupiedAppointment {
  dentist: string;
  patient: string;
  startTime: string;
  endTime: string;
  serviceMinutes: number;
}

export function calendarDay(date: Date): Date {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new BadRequestException('Invalid appointment date');
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function timeMinutes(time: string): number {
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new BadRequestException('Invalid appointment time');
  }
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function withinHours(hours: OperatingHour[] | undefined, day: string, start: number, end: number, label: string) {
  const allowed = hours?.some(hour => hour.day.toLowerCase() === day &&
    start >= timeMinutes(hour.startTime) && end <= timeMinutes(hour.endTime));
  if (!allowed) throw new BadRequestException(`Appointment is outside ${label} operating hours`);
}

export function validateSchedule(
  request: ScheduleRequest,
  dentist: ScheduleDentist,
  clinicHours: OperatingHour[] | undefined,
  serviceMinutes: number,
  occupied: readonly OccupiedAppointment[],
): void {
  if (dentist.role !== 'dentist' || dentist.status !== 'confirmed') {
    throw new BadRequestException('Select a confirmed dentist');
  }
  if (!assignedClinicIds(dentist).includes(request.clinic)) {
    throw new BadRequestException('Dentist is not assigned to the selected clinic');
  }
  const date = calendarDay(request.date);
  const start = timeMinutes(request.startTime);
  const end = timeMinutes(request.endTime);
  if (end <= start || end - start < serviceMinutes) {
    throw new BadRequestException('Appointment interval must cover the selected services');
  }
  const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getUTCDay()];
  withinHours(dentist.operatingHours, day, start, end, 'dentist');
  withinHours(clinicHours, day, start, end, 'clinic');
  const buffer = dentist.appointmentBufferMinutes;
  const capacity = dentist.maxWorkingMinutesPerDay;
  if (!Number.isFinite(buffer) || buffer < 0 || !Number.isFinite(capacity) || capacity <= 0) {
    throw new BadRequestException('Dentist scheduling limits are unavailable');
  }
  let usedMinutes = end - start + buffer;
  for (const appointment of occupied) {
    const otherStart = timeMinutes(appointment.startTime);
    const otherDuration = Math.max(timeMinutes(appointment.endTime) - otherStart, appointment.serviceMinutes);
    const otherEnd = otherStart + otherDuration;
    if (appointment.dentist === request.dentist) {
      if (start < otherEnd + buffer && end + buffer > otherStart) {
        throw new BadRequestException('Dentist already has an appointment during this time, including the required buffer');
      }
      usedMinutes += otherDuration + buffer;
    }
    if (appointment.patient === request.patient && start < otherEnd && end > otherStart) {
      throw new BadRequestException('Patient already has an appointment during this time');
    }
  }
  if (usedMinutes > capacity) {
    throw new BadRequestException('Dentist has no remaining working time for this day');
  }
}
