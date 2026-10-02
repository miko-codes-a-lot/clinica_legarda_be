import { ForbiddenException } from '@nestjs/common';
import { UserActor } from './role-policy';
import { referenceId } from './reference-id';

export function adminClinicIds(actor: UserActor): string[] {
  return [...new Set((actor.clinics ?? []).map(referenceId))];
}

export function canAccessClinic(actor: UserActor, clinic: unknown): boolean {
  if (actor.role === 'super-admin') return true;
  if (actor.role !== 'admin' || !clinic) return false;
  return adminClinicIds(actor).includes(referenceId(clinic));
}

export function assertClinicAccess(actor: UserActor, clinic: unknown): void {
  if (actor.role === 'admin' && !canAccessClinic(actor, clinic))
    throw new ForbiddenException('This clinic is outside your assignments.');
}

export function adminClinicScope(actor: UserActor): Record<string, unknown> {
  return actor.role === 'admin' ? { clinic: { $in: adminClinicIds(actor) } } : {};
}

/** Project memberships at every user population boundary without altering storage. */
export function visibleClinicMemberships<T extends { clinic?: unknown; clinics?: readonly unknown[] }>(
  value: T, actor: UserActor,
): T {
  if (!value || actor.role !== 'admin') return value;
  const allowed = adminClinicIds(actor);
  const clinics = (value.clinics ?? (value.clinic ? [value.clinic] : []))
    .filter(clinic => allowed.includes(referenceId(clinic)));
  return { ...value, clinics, clinic: clinics[0] } as T;
}
