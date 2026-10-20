import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CLINIC_NAME } from '../_shared/clinic-brand';
import { reservationDeadline } from '../appointments/appointment-time';
import { sendViaSemaphore } from '../auth/sms.helper';
import type { AppointmentEmailKind } from '../appointment-change-emails/entities/appointment-change-email.entity';
import type { AppointmentChangeMessage, AppointmentReminderEmail } from '../mailer/mailer.service';
import { isSmsRecipient } from './sms-recipient';

type Schedule = Pick<AppointmentReminderEmail, 'date' | 'startTime' | 'endTime'>;

const MANILA_OFFSET = 8 * 60 * 60 * 1000;

// Same wording as the appointment emails.
const COPY: Record<AppointmentEmailKind, { heading: string; message: string }> = {
  confirmed: { heading: 'Your appointment is confirmed', message: 'The clinic has confirmed your appointment.' },
  rescheduled: { heading: 'Your appointment was rescheduled', message: 'Clinic staff rescheduled your appointment. Sign in to review the revised schedule and latest appointment status.' },
  rejected: { heading: 'Your appointment request was declined', message: 'Your appointment request has been declined. Please contact the clinic to discuss another schedule.' },
  cancelled: { heading: 'Your appointment was cancelled', message: 'Your appointment has been cancelled. This time is no longer reserved for you.' },
  disrupted: { heading: 'Your appointment needs a new schedule', message: 'Dentist or clinic availability has changed. Your appointment needs a new schedule. Please contact the clinic; your existing appointment has not been automatically moved or cancelled.' },
};

// Texts use plain characters only (no en dash, middle dot or curly quotes) so they stay in the standard SMS alphabet.
const date = (value: string) => new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));
const time = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
};
const hours = (value: Schedule) => `${time(value.startTime)} - ${time(value.endTime)} (Philippine time)`;
const schedule = (value: Schedule) => `${date(value.date)}, ${hours(value)}`;

function arrivalNotice(appointment: Schedule): string {
  const local = new Date(reservationDeadline(new Date(appointment.date), appointment.startTime).getTime() + MANILA_OFFSET);
  const clock = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  return `Please check in by ${date(local.toISOString().slice(0, 10))} at ${time(clock)} (Philippine time), 20 minutes after your appointment starts. If you have not checked in by then, the appointment will be marked No-show. Contact the clinic if you need help.`;
}

@Injectable()
export class SmsService {
  ensureSendingAvailable(to: string): void {
    if (!isSmsRecipient(to)) {
      throw new BadRequestException('This mobile number cannot receive text messages. Ask the clinic to add a valid Philippine mobile number.');
    }
    if (!process.env.SEMAPHORE_API_KEY || !process.env.SEMAPHORE_SENDER_NAME) {
      throw new ServiceUnavailableException('Text message delivery is not configured.');
    }
  }

  async sendAppointmentChange(to: string, change: AppointmentChangeMessage): Promise<void> {
    this.ensureSendingAvailable(to);
    const { heading, message } = COPY[change.kind];
    const rescheduled = change.kind === 'rescheduled';
    const lines = [CLINIC_NAME, heading, message];
    if (change.patientName) lines.push(`Patient: ${change.patientName}`);
    lines.push(`Clinic: ${change.clinicName}`);
    if (change.clinicAddress) lines.push(`Address: ${change.clinicAddress}`);
    if (rescheduled && change.previousSchedule) lines.push(`Previous schedule: ${schedule(change.previousSchedule)}`);
    lines.push(`${rescheduled ? 'Revised schedule' : 'Appointment schedule'}: ${schedule(change)}`);
    if (change.reason) lines.push(`Reason: ${change.reason}`);
    lines.push(change.kind === 'confirmed' ? arrivalNotice(change) : 'Contact the clinic for help.');
    await sendViaSemaphore(to, lines.join('\n'));
  }

  async sendAppointmentReminder(to: string, appointment: AppointmentReminderEmail): Promise<void> {
    this.ensureSendingAvailable(to);
    const lines = [CLINIC_NAME, 'Your upcoming dental appointment', `This is a reminder of your confirmed appointment at ${appointment.clinicName}.`];
    if (appointment.patientName) lines.push(`Patient: ${appointment.patientName}`);
    lines.push(`Date: ${date(appointment.date)}`, `Time: ${hours(appointment)}`, `Clinic: ${appointment.clinicName}`);
    if (appointment.clinicAddress) lines.push(`Address: ${appointment.clinicAddress}`);
    lines.push(arrivalNotice(appointment));
    await sendViaSemaphore(to, lines.join('\n'));
  }
}
