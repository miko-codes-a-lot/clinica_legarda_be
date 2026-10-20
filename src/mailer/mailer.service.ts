import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { google } from 'googleapis';
import configuration from 'src/_shared/configuration';
import { CLINIC_NAME } from '../_shared/clinic-brand';
import { isEmailRecipient } from './email-recipient';
import { reservationDeadline } from '../appointments/appointment-time';
import { AppointmentEmailKind } from '../appointment-change-emails/entities/appointment-change-email.entity';

export interface AppointmentReminderEmail {
  patientName?: string;
  clinicName: string;
  clinicAddress: string;
  date: string;
  startTime: string;
  endTime: string;
  arrivalDeadline?: Date;
}

export interface AppointmentChangeMessage extends AppointmentReminderEmail {
  kind: AppointmentEmailKind;
  responseRequired?: boolean;
  previousSchedule?: Pick<AppointmentReminderEmail, 'date' | 'startTime' | 'endTime'>;
  reason?: string;
  changedAt: Date;
}

@Injectable()
export class MailerService {
  private oAuth2Client: InstanceType<typeof google.auth.OAuth2>;
  private readonly sendingPausedUntil?: number;

  constructor() {
    const { clientId, clientSecret, refreshToken, sendingPausedUntil } = configuration().gmail;
    if (sendingPausedUntil) {
      const deadline = Date.parse(sendingPausedUntil);
      if (!Number.isFinite(deadline)) throw new Error('GMAIL_SENDING_PAUSED_UNTIL must be a valid date.');
      this.sendingPausedUntil = deadline;
    }
    this.oAuth2Client = new google.auth.OAuth2({
      clientId, clientSecret,
      // OAuth refresh uses its own request before Gmail send. Bound both and
      // leave retry scheduling to the reminder worker, within its claim lease.
      transporterOptions: { timeout: 30_000, retryConfig: { retry: 0 } },
    });
    this.oAuth2Client.setCredentials({ refresh_token: refreshToken });
  }

  ensureSendingAvailable(to: string): void {
    if (!isEmailRecipient(to)) {
      throw new BadRequestException('This email address cannot receive messages. Ask the clinic to add a real email address.');
    }
    if (this.sendingPausedUntil !== undefined && Date.now() < this.sendingPausedUntil) {
      throw new ServiceUnavailableException('Email delivery is temporarily unavailable. Please try again later or contact the clinic.');
    }
  }

  async sendAppointmentChange(to: string, change: AppointmentChangeMessage): Promise<void> {
    this.ensureSendingAvailable(to);
    const escape = (value: string) => value.replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] ?? character);
    const date = (value: string) => new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00Z`));
    const time = (value: string) => {
      const [hours, minutes] = value.split(':').map(Number);
      return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
    };
    const schedule = (value: Pick<AppointmentReminderEmail, 'date' | 'startTime' | 'endTime'>) =>
      `${date(value.date)} · ${time(value.startTime)} – ${time(value.endTime)} (Philippine time)`;
    const confirmedReschedule = change.kind === 'confirmed' && !!change.previousSchedule;
    const rescheduled = change.kind === 'rescheduled' || confirmedReschedule;
    const copy: Record<AppointmentEmailKind, { heading: string; subject: string; message: string }> = {
      confirmed: { heading: 'Your appointment is confirmed', subject: 'Appointment confirmed', message: 'The clinic has confirmed your appointment.' },
      rescheduled: { heading: 'Your appointment was rescheduled', subject: 'Appointment rescheduled', message: 'Clinic staff rescheduled your appointment. Sign in to review the revised schedule and latest appointment status.' },
      rejected: { heading: 'Your appointment request was declined', subject: 'Appointment declined', message: 'Your appointment request has been declined. Please contact the clinic to discuss another schedule.' },
      cancelled: { heading: 'Your appointment was cancelled', subject: 'Appointment cancelled', message: 'Your appointment has been cancelled. This time is no longer reserved for you.' },
      disrupted: { heading: 'Your appointment needs a new schedule', subject: 'Appointment schedule needs attention', message: 'Dentist or clinic availability has changed. Your appointment needs a new schedule. Please contact the clinic; your existing appointment has not been automatically moved or cancelled.' },
    };
    const { heading, subject, message } = change.responseRequired ? {
      heading: 'Please respond to your proposed appointment schedule', subject: 'Appointment reschedule needs your response',
      message: 'The clinic proposed a new appointment time. Sign in to My appointments to accept it, request another time, or cancel. This appointment is not confirmed until you agree. If unanswered, it will be automatically cancelled when the proposed time starts.',
    } : confirmedReschedule ? { heading: 'Your revised appointment is confirmed', subject: 'Revised appointment confirmed',
      message: 'Your agreement to the clinic-proposed appointment time has been recorded. Your revised appointment is confirmed.' } : copy[change.kind];
    const changed = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(change.changedAt);
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172a2a;line-height:1.6">
      <h1>${heading}</h1><p>This update was made on ${changed} (Philippine time).</p>
      <p>${message}</p>
      <table cellpadding="8" style="border-collapse:collapse;text-align:left">
        ${change.patientName ? `<tr><th>Patient</th><td>${escape(change.patientName)}</td></tr>` : ''}
        <tr><th>Clinic</th><td>${escape(change.clinicName)}</td></tr>
        ${change.clinicAddress ? `<tr><th>Address</th><td>${escape(change.clinicAddress)}</td></tr>` : ''}
        ${rescheduled && change.previousSchedule ? `<tr><th>Previous schedule</th><td>${schedule(change.previousSchedule)}</td></tr>` : ''}
        <tr><th>${rescheduled ? 'Revised schedule' : 'Appointment schedule'}</th><td>${schedule(change)}</td></tr>
        ${change.reason ? `<tr><th>Reason</th><td>${escape(change.reason)}</td></tr>` : ''}
      </table>${change.kind === 'confirmed' ? this.arrivalNotice(change) : ''}<p>Sign in to your patient account for the latest appointment status, or contact the clinic for help.</p>
      <p>${escape(CLINIC_NAME)}</p></body></html>`;
    const raw = this.buildRawMessage(configuration().gmail.from!, to, `${subject} - ${CLINIC_NAME}`, html);
    const gmail = google.gmail({ version: 'v1', auth: this.oAuth2Client });
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } }, { timeout: 30_000, retry: false });
  }

  async sendAppointmentReminder(to: string, appointment: AppointmentReminderEmail): Promise<void> {
    this.ensureSendingAvailable(to);
    const escape = (value: string) => value.replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] ?? character);
    const date = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${appointment.date}T00:00:00Z`));
    const time = (value: string) => {
      const [hours, minutes] = value.split(':').map(Number);
      return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
    };
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172a2a;line-height:1.6">
      <h1>Your upcoming dental appointment</h1>
      <p>This is a reminder of your confirmed appointment at ${escape(appointment.clinicName)}.</p>
      <table cellpadding="8" style="border-collapse:collapse;text-align:left">
        ${appointment.patientName ? `<tr><th>Patient</th><td>${escape(appointment.patientName)}</td></tr>` : ''}
        <tr><th>Date</th><td>${date}</td></tr>
        <tr><th>Time</th><td>${time(appointment.startTime)} – ${time(appointment.endTime)} (Philippine time)</td></tr>
        <tr><th>Clinic</th><td>${escape(appointment.clinicName)}</td></tr>
        ${appointment.clinicAddress ? `<tr><th>Address</th><td>${escape(appointment.clinicAddress)}</td></tr>` : ''}
      </table>
      ${this.arrivalNotice(appointment)}
      <p>Please sign in to your patient account to review, reschedule, or cancel your appointment.</p>
      <p>${escape(CLINIC_NAME)}</p>
    </body></html>`;
    const rawMessage = this.buildRawMessage(configuration().gmail.from!, to, `Appointment reminder - ${CLINIC_NAME}`, html);
    const gmail = google.gmail({ version: 'v1', auth: this.oAuth2Client });
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: rawMessage } }, { timeout: 30_000, retry: false });
  }

  private arrivalNotice(appointment: AppointmentReminderEmail): string {
    const deadline = reservationDeadline(new Date(appointment.date), appointment.startTime);
    const label = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short' }).format(deadline);
    return `<p>Please check in by <strong>${label} (Philippine time)</strong>, 20 minutes after your appointment starts. If you have not checked in by then, the appointment will be marked No-show. Contact the clinic if you need help.</p>`;
  }

  async sendOtp(to: string, code: string): Promise<void> {
    this.ensureSendingAvailable(to);
    const { from } = configuration().gmail;

    const subject = `Login OTP - ${CLINIC_NAME}`;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="max-width: 480px; width: 100%;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f766e, #67b5a7); padding: 32px 40px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">${CLINIC_NAME}</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
              <h2 style="margin: 0 0 8px; color: #333333; font-size: 20px; font-weight: 600;">Login Verification</h2>
              <p style="margin: 0 0 24px; color: #666666; font-size: 14px; line-height: 1.5;">Use the code below to verify your identity. This code is valid for <strong>10 minutes</strong>.</p>
              <!-- OTP Code Box -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 0 0 24px;">
                    <div style="display: inline-block; background-color: #f5f5f5; border: 2px solid #0f766e; border-radius: 8px; padding: 16px 32px;">
                      <span style="font-size: 36px; font-weight: 700; letter-spacing: 10px; color: #0f766e;">${code}</span>
                    </div>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; color: #666666; font-size: 13px; line-height: 1.5;">If you did not request this code, you can safely ignore this email. Someone may have entered your email address by mistake.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; text-align: center;">
              <p style="margin: 0 0 4px; color: #999999; font-size: 12px;">${CLINIC_NAME}</p>
              <p style="margin: 0; color: #999999; font-size: 11px;">This is an automated message. Please do not reply to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const rawMessage = this.buildRawMessage(from!, to, subject, html);
    const gmail = google.gmail({ version: 'v1', auth: this.oAuth2Client });
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: rawMessage },
    }, { timeout: 30_000, retry: false });
  }

  private buildRawMessage(
    from: string,
    to: string,
    subject: string,
    html: string,
  ): string {
    const message = [
      `From: =?UTF-8?B?${Buffer.from(CLINIC_NAME).toString('base64')}?= <${from}>`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
    ].join('\r\n');

    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}
