import { UserActor } from '../auth/role-policy';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { referenceId, sameId } from '../auth/reference-id';
import { requireCareClinic } from './care-policy';

export function requireClinicalWriter(actor: UserActor, dentist: unknown, clinic: unknown): void {
  if (actor.role !== 'super-admin' && !(actor.role === 'dentist' && sameId(actor.sub, dentist)))
    throw new ForbiddenException('Only the responsible dentist can edit clinical records.');
  requireCareClinic(actor, referenceId(clinic));
}
export function assertClinicalRecordWrite(visit: { state: string; revision: number; dentist: unknown; clinic: unknown }, actor: UserActor, revision: number, complete: boolean, summary: string): void {
  requireClinicalWriter(actor, visit.dentist, visit.clinic);
  if (visit.state !== 'in_progress') throw new ConflictException('Start care before recording treatments. Ended visits are read-only.');
  if (visit.revision !== revision) throw new ConflictException('The clinical record changed. Reload before saving.');
  if (complete && !summary.trim()) throw new BadRequestException('A patient-facing summary is required to complete the visit.');
}

interface SummarySource {
  state: string;
  _id?: unknown;
  date?: string;
  clinic?: unknown;
  dentist?: unknown;
  purpose?: string;
  careCase?: unknown;
  summary?: string;
  aftercare?: string;
  nextSteps?: string;
  treatments?: readonly { description: string; tooth?: string; notes?: string }[];
}
export function publicVisitSummary<T extends SummarySource>(visit: T): Record<string, unknown> | null {
  if (visit.state !== 'completed' || !visit.summary?.trim()) return null;
  return { _id: visit._id, date: visit.date, clinic: visit.clinic, dentist: visit.dentist, purpose: visit.purpose,
    ...(visit.careCase ? { careCase: visit.careCase } : {}),
    summary: visit.summary, aftercare: visit.aftercare ?? '', nextSteps: visit.nextSteps ?? '',
    treatments: (visit.treatments ?? []).map(item => ({ description: item.description, ...(item.tooth ? { tooth: item.tooth } : {}) })),
  };
}
export function assertCareCaseLink(careCase: { patient: unknown; dentist: unknown; clinic: unknown; status: string }, session: { patient: unknown; dentist: unknown; clinic: unknown }): void {
  if (!sameId(careCase.patient, session.patient) || !sameId(careCase.clinic, session.clinic) || !sameId(careCase.dentist, session.dentist))
    throw new BadRequestException('The treatment case must belong to the same patient, clinic and responsible dentist.');
  if (careCase.status !== 'active') throw new ConflictException('This treatment case is closed.');
}
