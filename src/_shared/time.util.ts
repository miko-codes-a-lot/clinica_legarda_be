import * as dayjs from 'dayjs';

export function toMinutes(date: Date, time: string): number {
  return dayjs(`${dayjs(date).format('YYYY-MM-DD')} ${time}`).valueOf();
}

export function diffMinutes(
  date: Date,
  start: string,
  end: string,
): number {
  const s = dayjs(`${dayjs(date).format('YYYY-MM-DD')} ${start}`);
  const e = dayjs(`${dayjs(date).format('YYYY-MM-DD')} ${end}`);
  return e.diff(s, 'minute');
}
