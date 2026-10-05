import { BadRequestException, ConflictException } from '@nestjs/common';

function assertCalendarDate(value: string): void {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new BadRequestException('Enter a valid calendar date as YYYY-MM-DD.');
}
export interface ClosureInterval { startDate: string; endDate: string; startTime: string; endTime: string; status?: string; }
export function assertClosureRange(range: ClosureInterval) {
  assertCalendarDate(range.startDate); assertCalendarDate(range.endDate);
  const days = (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86400000;
  if (days < 0 || days > 366) throw new BadRequestException('Closures must span an ordered range of at most 367 calendar days.');
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(range.startTime) || (!time.test(range.endTime) && range.endTime !== '24:00') || range.startTime >= range.endTime)
    throw new BadRequestException('Enter increasing daily closure times between 00:00 and 24:00.');
}
export function closureOverlaps(range: ClosureInterval, day: string, startTime: string, endTime: string): boolean {
  return range.status !== 'reopened' && day >= range.startDate && day <= range.endDate && startTime < range.endTime && endTime > range.startTime;
}
export function assertOpenInterval(closures: readonly ClosureInterval[], day: string, startTime: string, endTime: string) {
  if (closures.some(closure => closureOverlaps(closure, day, startTime, endTime)))
    throw new ConflictException('This clinic is closed during the selected interval. Choose another available date or time.');
}
