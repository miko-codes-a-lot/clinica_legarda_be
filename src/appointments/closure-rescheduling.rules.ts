export interface ClosureReschedulingContext {
  originalStatus: string;
  originalSchedule: { date: string; startTime: string; endTime: string };
  enteredAt: Date;
  expiresAt?: Date;
  reasons: string[];
}

export function closureReschedulingDeadline(enteredAt: Date): Date { return new Date(enteredAt.getTime() + 7 * 24 * 60 * 60_000); }
export function closureReschedulingExpired(context: { expiresAt?: Date }, now: Date): boolean { return !!context.expiresAt && now.getTime() >= context.expiresAt.getTime(); }
export function enterClosureRescheduling(
  current: { date: Date; startTime: string; endTime: string; status: string; closureRescheduling?: ClosureReschedulingContext },
  reason: string,
  now: Date,
): ClosureReschedulingContext & { expiresAt: Date } {
  const previous = current.closureRescheduling;
  return {
    originalStatus: previous?.originalStatus ?? current.status,
    originalSchedule: previous?.originalSchedule ?? { date: current.date.toISOString().slice(0, 10), startTime: current.startTime, endTime: current.endTime },
    enteredAt: previous?.expiresAt ? previous.enteredAt : now,
    expiresAt: previous?.expiresAt ?? closureReschedulingDeadline(now),
    reasons: [...new Set([...(previous?.reasons ?? []), reason.trim()])],
  };
}
