export interface ClosurePreviewPerson { _id: string; firstName?: string; middleName?: string; lastName?: string; username?: string }
export interface ClosurePreviewRow {
  _id: string;
  patient: ClosurePreviewPerson | null;
  dentist: ClosurePreviewPerson | null;
  clinic?: { _id: string; name?: string } | null;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  services: ({ _id: string; name: string } | null)[];
  disruption?: { closures?: unknown[]; dentistAvailability?: unknown[]; message?: string };
  closureRescheduling?: { expiresAt?: string };
  rescheduleProposal?: { id: string };
  protectedCare?: boolean;
  closureEffect?: 'needs_rescheduling' | 'already_needs_rescheduling' | 'manual_review';
  proposalDeadline?: string;
}
export interface ClosureImpactSummary {
  total: number; newlyNeedsRescheduling: number; alreadyNeedsRescheduling: number; protectedCare: number;
  immediateCancellations: number; cancellationRisk: number;
  distinctPatients: number; distinctDentists: number; distinctServices: number;
  services: { id: string; name: string; appointments: number }[];
  byStatus: Record<string, number>; byDay: Record<string, number>;
  scheduledMinutes: number; firstSchedule: string | null; lastSchedule: string | null;
  urgentAppointments: number; proposalsWithdrawn: number; alreadyDisrupted: number; missingReferenceAppointments: number;
  missingEmailPatients: number; missingSmsPatients: number; manualContactPatients: number;
}
export interface ClosurePreview {
  appointments: ClosurePreviewRow[];
  total: number;
  generatedAt: string;
  impactToken: string;
  summary: ClosureImpactSummary;
}
