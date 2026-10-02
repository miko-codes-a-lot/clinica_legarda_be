import { assertClosureRange, closureOverlaps, assertOpenInterval } from './closure-rules';
describe('Clinic closure interval rules', () => {
  const closure = { startDate: '2026-10-03', endDate: '2026-10-05', startTime: '09:00', endTime: '12:00', status: 'active' };
  it('blocks inclusive dates and overlapping intervals but permits adjacent appointments', () => {
    expect(closureOverlaps(closure, '2026-10-03', '08:30', '09:30')).toBe(true);
    expect(closureOverlaps(closure, '2026-10-05', '11:30', '12:30')).toBe(true);
    expect(closureOverlaps(closure, '2026-10-03', '08:00', '09:00')).toBe(false);
    expect(closureOverlaps(closure, '2026-10-03', '12:00', '12:30')).toBe(false);
    expect(closureOverlaps(closure, '2026-10-06', '10:00', '11:00')).toBe(false);
  });
  it('retains reopened ranges while removing their blocking effect', () => {
    expect(() => assertOpenInterval([closure], '2026-10-04', '10:00', '11:00')).toThrow();
    expect(() => assertOpenInterval([{ ...closure, status: 'reopened' }], '2026-10-04', '10:00', '11:00')).not.toThrow();
  });
  it('validates real calendar dates, daily intervals and bounded ranges', () => {
    expect(() => assertClosureRange({ ...closure, startTime: '00:00', endTime: '24:00' })).not.toThrow();
    for (const changes of [{ startDate: '2026-02-30' }, { endDate: '2026-10-02' }, { endDate: '2028-01-01' }, { startTime: '12:00', endTime: '09:00' }, { startTime: '24:00' }]) expect(() => assertClosureRange({ ...closure, ...changes })).toThrow();
  });
});
