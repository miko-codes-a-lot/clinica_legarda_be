import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { clinicReferenceId } from '../users/clinic-membership';
import { isAdmin, UserActor } from './role-policy';

export function referenceId(value: unknown): string {
  const id = clinicReferenceId(value);
  if (!id || !Types.ObjectId.isValid(id))
    throw new BadRequestException('Invalid record ID.');
  return new Types.ObjectId(id).toHexString();
}

export function sameId(left: unknown, right: unknown): boolean {
  return referenceId(left) === referenceId(right);
}

export function appointmentScope(actor: UserActor): Record<string, unknown> {
  if (isAdmin(actor)) return {};
  if (actor?.role === 'dentist') return { dentist: referenceId(actor.sub) };
  if (actor?.role === 'user') return { patient: referenceId(actor.sub) };
  throw new ForbiddenException('You cannot access appointments.');
}

export function authorizeAppointment(
  actor: UserActor,
  record: { dentist: unknown; patient: unknown },
  clinical = false,
): void {
  if (isAdmin(actor)) return;
  if (actor?.role === 'dentist' && sameId(actor.sub, record.dentist)) return;
  if (!clinical && actor?.role === 'user' && sameId(actor.sub, record.patient))
    return;
  throw new ForbiddenException('You cannot access this appointment.');
}
