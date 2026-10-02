import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

export function manilaDay(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function assertIntakePatient(status?: string): void {
  if (status !== 'confirmed' && status !== 'walk_in')
    throw new BadRequestException('Select a confirmed or staff-registered walk-in patient.');
}
export function assertAppointmentCheckIn(appointment: { status: string; date: Date }, day: string): void {
  if (appointment.status !== 'confirmed') throw new ConflictException('Only a confirmed appointment can be checked in.');
  if (appointment.date.toISOString().slice(0, 10) !== day) throw new ConflictException('Check-in is available only on the appointment date.');
}
export function assertQueueTransition(current: string, next: string, role: string, responsible: boolean, reason?: string): void {
  if (!['waiting', 'in_progress'].includes(current)) throw new ConflictException('This visit has already ended.');
  if (next === 'in_progress') {
    if (current !== 'waiting') throw new ConflictException('The visit is already in progress.');
    if (role !== 'super-admin' && !(role === 'dentist' && responsible))
      throw new ForbiddenException('Only the responsible dentist can start care.');
    return;
  }
  if (next === 'cancelled') {
    if (!['admin', 'super-admin'].includes(role) && !(role === 'dentist' && responsible))
      throw new ForbiddenException('You cannot cancel this visit.');
    if (!reason?.trim() || reason.length > 500) throw new BadRequestException('Enter a cancellation reason of up to 500 characters.');
    return;
  }
  if (next === 'completed') throw new BadRequestException('Save the clinical record and patient summary to complete care.');
  throw new ConflictException('This queue transition is unavailable.');
}
