import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserActor } from '../auth/role-policy';
import { referenceId } from '../auth/reference-id';
import { adminClinicScope } from '../auth/clinic-policy';

export function requireCareStaff(actor: UserActor): void {
  if (!['admin', 'super-admin', 'dentist'].includes(actor.role))
    throw new ForbiddenException('Only clinic staff can access patient records.');
}

export function requireCareClinic(actor: UserActor, clinic: string): void {
  const id = referenceId(clinic);
  if (actor.role === 'super-admin') return;
  if (!['admin', 'dentist'].includes(actor.role) || !(actor.clinics ?? []).map(referenceId).includes(id))
    throw new ForbiddenException('This clinic is outside your assignments.');
}

export function careScope(actor: UserActor, clinic?: string): Record<string, unknown> {
  let scope: Record<string, unknown>;
  if (actor.role === 'super-admin') scope = {};
  else if (actor.role === 'admin') scope = adminClinicScope(actor);
  else if (actor.role === 'dentist') scope = { dentist: referenceId(actor.sub) };
  else if (actor.role === 'user') scope = { patient: referenceId(actor.sub) };
  else throw new ForbiddenException('You cannot access care records.');
  if (!clinic) return scope;
  if (actor.role !== 'user') requireCareClinic(actor, clinic);
  return { ...scope, clinic: referenceId(clinic) };
}

export function patientSearchFilter(search?: string): Record<string, unknown> {
  const text = search?.trim() ?? '';
  if (text.length > 100) throw new BadRequestException('Search must be 100 characters or fewer.');
  if (!text) return {};
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts: Record<string, unknown>[] = ['firstName', 'middleName', 'lastName', 'username', 'emailAddress', 'mobileNumber']
    .map(field => ({ [field]: { $regex: escaped, $options: 'i' } }));
  // A full name is searched as literal text; never execute user-supplied regex.
  parts.push({ $expr: { $regexMatch: {
    input: { $concat: [{ $ifNull: ['$firstName', ''] }, ' ', { $ifNull: ['$lastName', ''] }] },
    regex: escaped, options: 'i',
  } } });
  if (Types.ObjectId.isValid(text)) parts.push({ _id: referenceId(text) });
  return { $or: parts };
}
