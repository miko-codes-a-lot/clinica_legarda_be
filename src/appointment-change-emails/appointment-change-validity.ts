import { AppointmentDocument } from '../appointments/entities/appointment.entity';
import { appointmentStart, reservationDeadline } from '../appointments/appointment-time';
import { AppointmentChangeEmail } from './entities/appointment-change-email.entity';

/** These notices describe a live appointment, so they are re-checked against it; declined and cancelled ones stay true. */
export const NEEDS_CURRENT_APPOINTMENT: string[] = ['confirmed', 'rescheduled', 'disrupted', 'needs_rescheduling'];

/** Whether the appointment still matches the snapshot a queued notice was written for. */
export function changeStillApplies(claimed: AppointmentChangeEmail, current: AppointmentDocument | null): boolean {
  if (claimed.proposalDeadline && (claimed.proposalDeadline.getTime() <= Date.now() || current?.closureRescheduling?.expiresAt?.getTime() !== claimed.proposalDeadline.getTime())) return false;
  return !!current && (claimed.scheduleVersion === undefined || (current.scheduleVersion ?? 0) === claimed.scheduleVersion) && current.date.toISOString().slice(0, 10) === claimed.schedule.date &&
    current.startTime === claimed.schedule.startTime && current.endTime === claimed.schedule.endTime &&
    current.patient.toString() === claimed.patient.toString() && current.clinic.toString() === claimed.clinic.toString() &&
    (claimed.kind === 'needs_rescheduling' ? current.status === 'needs_rescheduling' && !!current.closureRescheduling && current.closureRescheduling.expiresAt?.getTime() === claimed.proposalDeadline?.getTime() : claimed.kind === 'confirmed' ? current.status === 'confirmed' && !current.disruption &&
      reservationDeadline(current.date, current.startTime).getTime() > Date.now()
      : claimed.kind === 'rescheduled' ? (claimed.proposalId ? !current.disruption && current.status === 'pending' && current.rescheduleProposal?.id === claimed.proposalId &&
        appointmentStart(current.date, current.startTime).getTime() > Date.now() : ['pending', 'confirmed'].includes(current.status)) : !!current.disruption && ['pending', 'confirmed', 'needs_rescheduling'].includes(current.status));
}
