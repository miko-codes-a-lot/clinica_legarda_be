import { appointmentStart, reservationDeadline } from '../appointments/appointment-time';

export function isDueNoShow(appointment: { date: Date; startTime: string; status: string; isWalkIn?: boolean; disruption?: unknown }, now: Date, enforceFrom: Date): boolean {
  if (appointment.status !== 'confirmed' || appointment.isWalkIn || appointment.disruption || !Number.isFinite(now.getTime()) || !Number.isFinite(enforceFrom.getTime())) return false;
  try { return appointmentStart(appointment.date, appointment.startTime).getTime() >= enforceFrom.getTime() && reservationDeadline(appointment.date, appointment.startTime).getTime() <= now.getTime(); }
  catch { return false; }
}
