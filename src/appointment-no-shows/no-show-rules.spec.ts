import { isDueNoShow } from './no-show-rules';

describe('Prospective No-show rules', () => {
  const row = { date: new Date('2026-10-21'), startTime: '09:00', status: 'confirmed', isWalkIn: false };
  const from = new Date('2026-10-20T00:00:00Z');
  it('uses the exact 20-minute boundary, even for a service shorter than the grace period', () => {
    expect(isDueNoShow(row, new Date('2026-10-21T01:19:59.999Z'), from)).toBe(false);
    expect(isDueNoShow(row, new Date('2026-10-21T01:20:00Z'), from)).toBe(true);
  });
  it('excludes historical, non-confirmed, walk-in and disrupted appointments', () => {
    const now = new Date('2026-10-21T01:20:00Z');
    expect(isDueNoShow(row, now, new Date('2026-10-21T01:01:00Z'))).toBe(false);
    for (const status of ['pending', 'cancelled', 'rejected', 'completed', 'no_show']) expect(isDueNoShow({ ...row, status }, now, from)).toBe(false);
    expect(isDueNoShow({ ...row, isWalkIn: true }, now, from)).toBe(false);
    expect(isDueNoShow({ ...row, disruption: {} }, now, from)).toBe(false);
  });
  it('handles a Manila midnight appointment on the previous UTC day', () => {
    expect(isDueNoShow({ ...row, startTime: '00:00' }, new Date('2026-10-20T16:20:00Z'), from)).toBe(true);
  });
});
