import { BadRequestException } from '@nestjs/common';
import { timeMinutes } from '../appointments/appointment-scheduling.rules';

export interface AvailabilityInterval { startTime: string; endTime: string; }
export function validateIntervals(intervals: readonly AvailabilityInterval[]): AvailabilityInterval[] {
  if (!Array.isArray(intervals) || intervals.length > 12) throw new BadRequestException('Use at most 12 availability intervals.');
  const sorted = intervals.map(interval => ({ startTime: interval.startTime, endTime: interval.endTime }))
    .sort((a, b) => timeMinutes(a.startTime) - timeMinutes(b.startTime));
  sorted.forEach((row, index) => {
    if (timeMinutes(row.endTime) <= timeMinutes(row.startTime) ||
      (index > 0 && timeMinutes(row.startTime) < timeMinutes(sorted[index - 1].endTime)))
      throw new BadRequestException('Availability intervals must be valid and must not overlap.');
  });
  return sorted;
}
export function isAvailable(intervals: readonly AvailabilityInterval[], start: string, end: string): boolean {
  return intervals.some(row => timeMinutes(start) >= timeMinutes(row.startTime) && timeMinutes(end) <= timeMinutes(row.endTime));
}
export function assertAvailable(intervals: readonly AvailabilityInterval[], start: string, end: string): void {
  if (!isAvailable(intervals, start, end)) throw new BadRequestException('Dentist is unavailable during this time.');
}
export function assertAvailabilityRange(from: string, to: string): void {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000)
    throw new BadRequestException('Select a valid date range of at most one year.');
}
