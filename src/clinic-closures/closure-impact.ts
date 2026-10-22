import { closureReschedulingDeadline } from '../appointments/closure-rescheduling.rules';
import { ClosurePreviewRow, ClosureImpactSummary } from './dto/closure-preview.dto';
export type ClosureImpactRow = ClosurePreviewRow;
export type RecipientCoverage = Record<string, { email: boolean; sms: boolean }>;

/** Aggregates the entire matched set, independently of any table paging/filtering. */
export function buildClosureImpact(rows: ClosureImpactRow[], coverage: RecipientCoverage, generatedAt: Date): { appointments: ClosurePreviewRow[]; summary: ClosureImpactSummary } {
  const summary: ClosureImpactSummary = {
    total: rows.length, newlyNeedsRescheduling: 0, alreadyNeedsRescheduling: 0, protectedCare: 0,
    immediateCancellations: 0, cancellationRisk: 0, distinctPatients: 0, distinctDentists: 0, distinctServices: 0,
    services: [], byStatus: {}, byDay: {}, scheduledMinutes: 0, firstSchedule: null, lastSchedule: null,
    urgentAppointments: 0, proposalsWithdrawn: 0, alreadyDisrupted: 0, missingReferenceAppointments: 0,
    missingEmailPatients: 0, missingSmsPatients: 0, manualContactPatients: 0,
  };
  const patients = new Set<string>(), dentists = new Set<string>();
  const services = new Map<string, { id: string; name: string; appointments: number }>();
  const appointments = rows.map(row => {
    const day = row.date.slice(0, 10), schedule = `${day} ${row.startTime}`;
    summary.byStatus[row.status] = (summary.byStatus[row.status] ?? 0) + 1;
    summary.byDay[day] = (summary.byDay[day] ?? 0) + 1;
    summary.firstSchedule = !summary.firstSchedule || schedule < summary.firstSchedule ? schedule : summary.firstSchedule;
    summary.lastSchedule = !summary.lastSchedule || schedule > summary.lastSchedule ? schedule : summary.lastSchedule;
    const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
    const duration = minutes(row.endTime) - minutes(row.startTime);
    if (Number.isFinite(duration) && duration > 0) summary.scheduledMinutes += duration;
    const until = Date.parse(`${day}T${row.startTime}:00+08:00`) - generatedAt.getTime();
    if (until >= 0 && until <= 24 * 60 * 60_000) summary.urgentAppointments++;
    if (row.patient) patients.add(row.patient._id);
    if (row.dentist) dentists.add(row.dentist._id);
    if (!row.patient || !row.dentist || !row.services.length || row.services.some(service => !service)) summary.missingReferenceAppointments++;
    for (const service of new Map(row.services.filter(service => !!service).map(service => [service._id, service])).values()) {
      const count = services.get(service._id) ?? { id: service._id, name: service.name || 'Unavailable service', appointments: 0 };
      count.appointments++; services.set(service._id, count);
    }
    if (row.disruption) summary.alreadyDisrupted++;
    if (row.protectedCare) { summary.protectedCare++; return { ...row, closureEffect: 'manual_review' as const }; }
    summary.cancellationRisk++;
    if (row.rescheduleProposal) summary.proposalsWithdrawn++;
    const already = row.status === 'needs_rescheduling';
    if (already) summary.alreadyNeedsRescheduling++; else summary.newlyNeedsRescheduling++;
    return { ...row, closureEffect: already ? 'already_needs_rescheduling' as const : 'needs_rescheduling' as const,
      proposalDeadline: row.closureRescheduling?.expiresAt ?? closureReschedulingDeadline(generatedAt).toISOString() };
  });
  summary.distinctPatients = patients.size; summary.distinctDentists = dentists.size; summary.distinctServices = services.size;
  summary.services = [...services.values()].sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const id of patients) {
    const contact = coverage[id];
    if (!contact?.email) summary.missingEmailPatients++;
    if (!contact?.sms) summary.missingSmsPatients++;
    if (!contact?.email && !contact?.sms) summary.manualContactPatients++;
  }
  return { appointments, summary };
}
