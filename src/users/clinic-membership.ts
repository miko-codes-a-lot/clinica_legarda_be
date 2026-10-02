import { Types } from 'mongoose';

export interface ClinicMembership {
  clinic?: unknown;
  clinics?: readonly unknown[];
}

export function clinicReferenceId(reference: unknown): string | undefined {
  if (typeof reference === 'string') return reference;
  if (reference instanceof Types.ObjectId) return reference.toHexString();
  if (reference && typeof reference === 'object' && '_id' in reference) {
    return clinicReferenceId(reference._id);
  }
  return undefined;
}

/** Only an absent array falls back to the legacy assignment; [] revokes it. */
export function assignedClinicIds(user: ClinicMembership): string[] {
  const references = user.clinics !== undefined ? user.clinics : [user.clinic];
  return [
    ...new Set(
      (references ?? [])
        .map(clinicReferenceId)
        .filter((id): id is string => !!id),
    ),
  ];
}

/** Mongo equivalent of assignedClinicIds, including absent-only legacy fallback. */
export function clinicMembershipFilter(clinicId: string | readonly string[]) {
  const match = typeof clinicId === 'string' ? clinicId : { $in: [...clinicId] };
  return {
    $or: [
      { clinics: match },
      { clinics: { $exists: false }, clinic: match },
    ],
  };
}
