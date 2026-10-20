import { ConflictException } from '@nestjs/common';
import { ClientSession, Model } from 'mongoose';
import { referenceId } from '../auth/reference-id';
import { User } from './entities/user.entity';

/** Explicit scopes keep historical population available without global query hooks. */
export const ACTIVE_ACCOUNT = { deletedAt: { $exists: false } } as const;
export const ACTIVE_PATIENT = { role: 'user', ...ACTIVE_ACCOUNT } as const;

export async function activePatientScope(
  users: Model<User>,
  session?: ClientSession,
) {
  const ids = await users
    .distinct('_id', ACTIVE_PATIENT)
    .session(session ?? null)
    .exec();
  return { patient: { $in: ids } };
}

export async function requireActivePatient(
  users: Model<User>,
  patient: unknown,
  session?: ClientSession,
) {
  if (
    !(await users
      .exists({ _id: referenceId(patient), ...ACTIVE_PATIENT })
      .session(session ?? null))
  ) {
    throw new ConflictException(
      'This patient has been deleted or is unavailable. Retained records are read-only.',
    );
  }
}
