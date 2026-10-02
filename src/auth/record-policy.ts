import { ForbiddenException } from '@nestjs/common';
import { UserActor } from './role-policy';
import { adminClinicScope, assertClinicAccess } from './clinic-policy';
import { referenceId, sameId } from './reference-id';
export { referenceId, sameId } from './reference-id';

export function appointmentScope(actor: UserActor): Record<string, unknown> {
  if (actor?.role === 'super-admin') return {};
  if (actor?.role === 'admin') return adminClinicScope(actor);
  if (actor?.role === 'dentist') return { dentist: referenceId(actor.sub) };
  if (actor?.role === 'user') return { patient: referenceId(actor.sub) };
  throw new ForbiddenException('You cannot access appointments.');
}

export function authorizeAppointment(
  actor: UserActor,
  record: { dentist: unknown; patient: unknown; clinic?: unknown },
  clinical = false,
): void {
  if (actor?.role === 'super-admin') return;
  if (actor?.role === 'admin') {
    assertClinicAccess(actor, record.clinic);
    return;
  }
  if (actor?.role === 'dentist' && sameId(actor.sub, record.dentist)) return;
  if (!clinical && actor?.role === 'user' && sameId(actor.sub, record.patient))
    return;
  throw new ForbiddenException('You cannot access this appointment.');
}
