import { AppointmentDocument } from '../appointments/entities/appointment.entity';
import { reservationDeadline } from '../appointments/appointment-time';
import { AppointmentChangeEmail } from './entities/appointment-change-email.entity';

/** These notices describe a live appointment, so they are re-checked against it; declined and cancelled ones stay true. */
export const NEEDS_CURRENT_APPOINTMENT: string[] = ['confirmed', 'rescheduled', 'disrupted'];

/** Whether the appointment still matches the snapshot a queued notice was written for. */
export function changeStillApplies(claimed: AppointmentChangeEmail, current: AppointmentDocument | null): boolean {
  return !!current && current.date.toISOString().slice(0, 10) === claimed.schedule.date &&
    current.startTime === claimed.schedule.startTime && current.endTime === claimed.schedule.endTime &&
    current.patient.toString() === claimed.patient.toString() && current.clinic.toString() === claimed.clinic.toString() &&
    (claimed.kind === 'confirmed' ? current.status === 'confirmed' && !current.disruption &&
      reservationDeadline(current.date, current.startTime).getTime() > Date.now()
      : claimed.kind === 'rescheduled' ? current.status === 'pending' : !!current.disruption && ['pending', 'confirmed'].includes(current.status));
}
