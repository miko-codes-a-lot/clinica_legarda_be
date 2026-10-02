import { UserStatus } from '../_shared/enum/user-status.enum';

export function patientBookingStatuses(role: string): UserStatus[] {
  return role === 'user'
    ? [UserStatus.CONFIRMED]
    : [UserStatus.CONFIRMED, UserStatus.WALK_IN];
}
