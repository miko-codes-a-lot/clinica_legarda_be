import { buildClosureImpact, ClosureImpactRow } from './closure-impact';

describe('Closure preview totals from the full affected set', () => {
  const now = new Date('2026-10-22T04:00:00Z');
  const row = (id: string, patient: string, dentist: string, services: { _id: string; name: string }[]): ClosureImpactRow => ({
    _id: id, patient: { _id: patient, firstName: 'Same name' }, dentist: { _id: dentist, firstName: 'Same name' },
    date: '2026-10-23', startTime: '10:00', endTime: '10:30', status: 'confirmed', services,
  });
  const a = { _id: 'a', name: 'Cleaning' }, b = { _id: 'b', name: 'Consultation' };
  it('deduplicates identities and services per appointment, without undercounting multiple services', () => {
    const rows = [row('1', 'p1', 'd1', [a, a, b]), row('2', 'p1', 'd2', [b]), row('3', 'p2', 'd1', [a])];
    const result = buildClosureImpact(rows, { p1: { email: true, sms: false }, p2: { email: false, sms: false } }, now);
    expect(result.summary).toMatchObject({ total: 3, newlyNeedsRescheduling: 3, immediateCancellations: 0, cancellationRisk: 3,
      distinctPatients: 2, distinctDentists: 2, distinctServices: 2, scheduledMinutes: 90,
      missingEmailPatients: 1, missingSmsPatients: 2, manualContactPatients: 1, byStatus: { confirmed: 3 }, byDay: { '2026-10-23': 3 } });
    expect(result.summary.services).toEqual([{ id: 'a', name: 'Cleaning', appointments: 2 }, { id: 'b', name: 'Consultation', appointments: 2 }]);
    expect(result.appointments).toHaveLength(3);
    expect(result.appointments[0].proposalDeadline).toBe('2026-10-29T04:00:00.000Z');
  });
  it('separates protected care, existing deadlines, withdrawn proposals and retained missing references', () => {
    const result = buildClosureImpact([
      { ...row('1','p1','d1', [a]), protectedCare: true },
      { ...row('2','p1','d2', []), status: 'needs_rescheduling', closureRescheduling: { expiresAt: '2026-10-24T01:00:00Z' }, rescheduleProposal: { id: 'old' } },
      { ...row('3','p2','d1', []), dentist: null, services: [null] },
    ], {}, now);
    expect(result.summary).toMatchObject({ newlyNeedsRescheduling: 1, alreadyNeedsRescheduling: 1, protectedCare: 1, cancellationRisk: 2, proposalsWithdrawn: 1, missingReferenceAppointments: 2 });
    expect(result.appointments[0].closureEffect).toBe('manual_review');
    expect(result.appointments[0].proposalDeadline).toBeUndefined();
    expect(result.appointments[1].proposalDeadline).toBe('2026-10-24T01:00:00Z');
  });
  it('handles an empty interval without a fabricated earliest booking or cancellation', () => {
    const { summary } = buildClosureImpact([], {}, now);
    expect(summary.total).toBe(0); expect(summary.services).toEqual([]); expect(summary.firstSchedule).toBeNull();
    expect(summary.immediateCancellations).toBe(0); expect(summary.cancellationRisk).toBe(0);
  });
});
