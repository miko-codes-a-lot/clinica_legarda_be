import { enterClosureRescheduling, closureReschedulingDeadline, closureReschedulingExpired } from './closure-rescheduling.rules';

describe('Closure rescheduling clock', () => {
  const entered = new Date('2026-10-22T04:00:00Z');
  const schedule = { date: new Date('2026-11-02T00:00:00Z'), startTime: '10:00', endTime: '11:00', status: 'confirmed' };
  it('uses exactly 168 hours, including the deadline instant', () => {
    const expiresAt = closureReschedulingDeadline(entered);
    expect(expiresAt.toISOString()).toBe('2026-10-29T04:00:00.000Z');
    expect(closureReschedulingExpired({ expiresAt }, new Date(expiresAt.getTime() - 1))).toBe(false);
    expect(closureReschedulingExpired({ expiresAt }, expiresAt)).toBe(true);
    expect(closureReschedulingExpired({}, expiresAt)).toBe(false);
  });
  it('retains the original arrangement and does not reset an existing deadline', () => {
    const context = enterClosureRescheduling(schedule, 'Equipment repairs', entered);
    expect(context.originalStatus).toBe('confirmed');
    expect(context.originalSchedule).toEqual({ date: '2026-11-02', startTime: '10:00', endTime: '11:00' });
    const next = enterClosureRescheduling({ ...schedule, closureRescheduling: context }, 'Flooding', new Date('2026-10-23T04:00:00Z'));
    expect(next.enteredAt).toEqual(entered);
    expect(next.expiresAt).toEqual(context.expiresAt);
    expect(next.reasons).toEqual(['Equipment repairs', 'Flooding']);
    expect(enterClosureRescheduling({ ...schedule, closureRescheduling: next }, 'Flooding', entered).reasons).toHaveLength(2);
  });
  it('restarts the week when a pending replacement is withdrawn or declined', () => {
    const context = enterClosureRescheduling(schedule, 'Equipment repairs', entered);
    const next = enterClosureRescheduling({ ...schedule, closureRescheduling: { ...context, expiresAt: undefined } }, 'Flooding', new Date('2026-10-23T04:00:00Z'));
    expect(next.expiresAt?.toISOString()).toBe('2026-10-30T04:00:00.000Z');
    expect(next.originalSchedule).toEqual(context.originalSchedule);
  });
});
