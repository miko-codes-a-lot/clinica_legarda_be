import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { clinicReferenceId } from '../users/clinic-membership';

export function referenceId(value: unknown): string {
  const id = clinicReferenceId(value);
  if (!id || !Types.ObjectId.isValid(id))
    throw new BadRequestException('Invalid record ID.');
  return new Types.ObjectId(id).toHexString();
}

export function sameId(left: unknown, right: unknown): boolean {
  return referenceId(left) === referenceId(right);
}
