import { reportPeriod } from './report-period';
describe('Clinic calendar report periods', () => {
  const now = new Date('2026-12-31T16:00:00Z');
  it('uses Monday weeks and Manila dates across year boundaries', () => {
    expect(reportPeriod(now, { period: 'week', anchor: '2026-01-01' })).toMatchObject({ start: '2025-12-29', end: '2026-01-04', bucketKeys: ['2025-12-29','2025-12-30','2025-12-31','2026-01-01','2026-01-02','2026-01-03','2026-01-04'] });
    expect(reportPeriod(now).today).toBe('2027-01-01');
  });
  it('includes every February leap day and uses Manila timestamp boundaries', () => {
    const period = reportPeriod(now, { period: 'month', anchor: '2028-02-29' });
    expect(period.start).toBe('2028-02-01'); expect(period.end).toBe('2028-02-29'); expect(period.bucketKeys).toHaveLength(29);
    expect(period.updateStart.toISOString()).toBe('2028-01-31T16:00:00.000Z'); expect(period.updateEnd.toISOString()).toBe('2028-02-29T16:00:00.000Z');
  });
  it('returns twelve month buckets for a year and rejects invalid/unbounded input', () => {
    expect(reportPeriod(now, { period: 'year', anchor: '2026-12-31' })).toMatchObject({ start: '2026-01-01', end: '2026-12-31', bucketKeys: Array.from({ length: 12 }, (_, month) => `2026-${String(month+1).padStart(2,'0')}`) });
    for (const anchor of ['2026-02-29','2026-13-01','1900-01-01','2101-01-01']) expect(() => reportPeriod(now, { period: 'week', anchor })).toThrow();
  });
});
