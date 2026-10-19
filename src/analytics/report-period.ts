import { BadRequestException } from '@nestjs/common';
const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
export type ReportPeriodKind = 'week' | 'month' | 'year';
export interface ReportQuery { period?: ReportPeriodKind; anchor?: string; }

/** Appointment dates are UTC calendar days; update timestamps are real instants. */
export function reportPeriod(now = new Date(Date.now()), query: ReportQuery = {}) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const anchor = query.anchor ?? today, kind = query.period ?? 'week';
  if (!['week','month','year'].includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !Number.isFinite(Date.parse(anchor)) ||
    new Date(anchor).toISOString().slice(0,10) !== anchor || Number(anchor.slice(0,4)) < 2000 || Number(anchor.slice(0,4)) > 2100)
    throw new BadRequestException('Select a valid week, month or year and a calendar date from 2000 to 2100.');
  const selected = new Date(anchor), year = selected.getUTCFullYear(), month = selected.getUTCMonth();
  const appointmentStart = kind === 'week' ? new Date(selected.getTime() - ((selected.getUTCDay() + 6) % 7) * DAY_MS)
    : new Date(Date.UTC(year, kind === 'year' ? 0 : month, 1));
  const appointmentEnd = kind === 'week' ? new Date(appointmentStart.getTime() + 7 * DAY_MS)
    : new Date(Date.UTC(kind === 'year' ? year + 1 : year, kind === 'year' ? 0 : month + 1, 1));
  const dateKeys = Array.from({ length: (appointmentEnd.getTime() - appointmentStart.getTime()) / DAY_MS }, (_, day) =>
    new Date(appointmentStart.getTime() + day * DAY_MS)
      .toISOString()
      .slice(0, 10),
  );
  const bucketKeys = kind === 'year' ? Array.from({ length: 12 }, (_, month) => `${year}-${String(month+1).padStart(2,'0')}`) : dateKeys;
  const labels = bucketKeys.map(key => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...(kind === 'year' ? { month: 'short' } as const : { month: 'short', day: 'numeric' } as const) }).format(new Date(key.length === 7 ? `${key}-01` : key)));
  return {
    kind, anchor, start: dateKeys[0], end: dateKeys[dateKeys.length-1], bucketKeys, labels,
    today,
    weekOf: dateKeys[0],
    weekEnd: dateKeys[dateKeys.length-1],
    dateKeys,
    appointmentStart,
    appointmentEnd,
    updateStart: new Date(appointmentStart.getTime() - MANILA_OFFSET_MS),
    updateEnd: new Date(appointmentEnd.getTime() - MANILA_OFFSET_MS),
    todayStart,
    todayEnd: new Date(todayStart.getTime() + DAY_MS),
  };
}
