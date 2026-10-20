import axios from 'axios';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { SmsService } from './sms.service';
import { AppointmentEmailKind } from '../appointment-change-emails/entities/appointment-change-email.entity';

jest.mock('axios');
const post = axios.post as jest.Mock;

const appointment = { clinicName: 'Test Clinic', clinicAddress: '12 Test St', date: '2026-10-21', startTime: '09:00', endTime: '09:30' };
const changedAt = new Date('2026-10-20T00:00:00Z');
/** What Semaphore actually receives for the most recent call. */
const request = () => Object.fromEntries(post.mock.calls.at(-1)?.[1] as URLSearchParams);
// GSM 03.38 basic alphabet: a text made only of these is billed as a plain 160-character SMS.
const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);

describe('Appointment SMS', () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: [{ message_id: 'm-1' }] });
    process.env.SEMAPHORE_API_KEY = 'test-key';
    process.env.SEMAPHORE_SENDER_NAME = 'TESTCLINIC';
  });
  afterEach(() => { delete process.env.SEMAPHORE_API_KEY; delete process.env.SEMAPHORE_SENDER_NAME; });

  it('texts the appointment reminder in the email format to the normalized number', async () => {
    await new SmsService().sendAppointmentReminder('+639171234567', {
      patientName: 'Alice Child', clinicName: 'Test Clinic', clinicAddress: '12 Test St',
      date: '2026-10-10', startTime: '09:30', endTime: '10:00',
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(request()).toEqual({
      sendername: 'TESTCLINIC', apikey: 'test-key', number: '639171234567',
      message: [
        'R. Nañez Dental Clinic',
        'Your upcoming dental appointment',
        'This is a reminder of your confirmed appointment at Test Clinic.',
        'Patient: Alice Child',
        'Date: October 10, 2026',
        'Time: 9:30 AM - 10:00 AM (Philippine time)',
        'Clinic: Test Clinic',
        'Address: 12 Test St',
        'Please check in by October 10, 2026 at 9:50 AM (Philippine time), 20 minutes after your appointment starts. If you have not checked in by then, the appointment will be marked No-show. Contact the clinic if you need help.',
      ].join('\n'),
    });
  });

  it('texts both the previous and revised schedule of a reschedule with its reason', async () => {
    await new SmsService().sendAppointmentChange('09171234567', {
      kind: 'rescheduled', patientName: 'Alice Child', clinicName: 'Test Clinic', clinicAddress: '12 Test St',
      date: '2026-10-20', startTime: '11:00', endTime: '11:30',
      previousSchedule: { date: '2026-10-19', startTime: '09:30', endTime: '10:00' },
      reason: 'Clinic schedule changed', changedAt,
    });
    expect(request().number).toBe('639171234567');
    expect(request().message).toBe([
      'R. Nañez Dental Clinic',
      'Your appointment was rescheduled',
      'Clinic staff rescheduled your appointment. The revised appointment is pending confirmation.',
      'Patient: Alice Child',
      'Clinic: Test Clinic',
      'Address: 12 Test St',
      'Previous schedule: October 19, 2026, 9:30 AM - 10:00 AM (Philippine time)',
      'Revised schedule: October 20, 2026, 11:00 AM - 11:30 AM (Philippine time)',
      'Reason: Clinic schedule changed',
      'Contact the clinic for help.',
    ].join('\n'));
  });

  it('states the exact 20-minute arrival deadline in a confirmation, and only there', async () => {
    const sms = new SmsService();
    await sms.sendAppointmentChange('+639171234567', { ...appointment, kind: 'confirmed', changedAt });
    const confirmation = request().message;
    expect(confirmation).toContain('Your appointment is confirmed');
    expect(confirmation).toContain('Please check in by October 21, 2026 at 9:20 AM (Philippine time), 20 minutes after your appointment starts');
    expect(confirmation).toContain('No-show');
    await sms.sendAppointmentChange('+639171234567', { ...appointment, kind: 'cancelled', changedAt });
    expect(request().message).not.toContain('No-show');
  });

  it.each([
    ['rejected', 'Your appointment request was declined', 'Please contact the clinic to discuss another schedule.'],
    ['cancelled', 'Your appointment was cancelled', 'This time is no longer reserved for you.'],
    ['disrupted', 'Your appointment needs a new schedule', 'your existing appointment has not been automatically moved or cancelled.'],
  ] as [AppointmentEmailKind, string, string][])('describes a %s appointment without claiming it is confirmed', async (kind, heading, detail) => {
    await new SmsService().sendAppointmentChange('+639171234567', { ...appointment, kind, changedAt });
    expect(request().message).toContain(heading);
    expect(request().message).toContain(detail);
    expect(request().message).not.toContain('is confirmed');
    expect(request().message).not.toContain('Previous schedule');
    expect(request().message).toContain('Appointment schedule: October 21, 2026, 9:00 AM - 9:30 AM (Philippine time)');
  });

  it('keeps every notice in the standard SMS alphabet so it is billed as plain text', async () => {
    const sms = new SmsService();
    const kinds: AppointmentEmailKind[] = ['confirmed', 'rescheduled', 'rejected', 'cancelled', 'disrupted'];
    for (const kind of kinds) {
      await sms.sendAppointmentChange('+639171234567', {
        ...appointment, kind, patientName: 'Niño Peña', reason: 'Dentist unavailable',
        previousSchedule: { date: '2026-10-19', startTime: '13:30', endTime: '14:00' }, changedAt,
      });
      expect([...request().message].filter(character => !GSM_BASIC.has(character))).toEqual([]);
    }
    await sms.sendAppointmentReminder('+639171234567', appointment);
    expect([...request().message].filter(character => !GSM_BASIC.has(character))).toEqual([]);
  });

  it('refuses an unusable number for every notice before contacting Semaphore', async () => {
    const sms = new SmsService();
    for (const number of ['', 'not-a-number', '+639171234567,+639181234567', '0281234567']) {
      await expect(sms.sendAppointmentReminder(number, appointment)).rejects.toBeInstanceOf(BadRequestException);
      await expect(sms.sendAppointmentChange(number, { ...appointment, kind: 'cancelled', changedAt })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('reports unavailable, without contacting Semaphore, when its credentials are not configured', async () => {
    delete process.env.SEMAPHORE_API_KEY;
    await expect(new SmsService().sendAppointmentReminder('+639171234567', appointment)).rejects.toBeInstanceOf(ServiceUnavailableException);
    process.env.SEMAPHORE_API_KEY = 'test-key';
    delete process.env.SEMAPHORE_SENDER_NAME;
    await expect(new SmsService().sendAppointmentChange('+639171234567', { ...appointment, kind: 'cancelled', changedAt }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(post).not.toHaveBeenCalled();
  });

  it('lets a provider failure reach the worker so it retries instead of marking the text sent', async () => {
    post.mockResolvedValue({ data: [] });
    await expect(new SmsService().sendAppointmentReminder('+639171234567', appointment)).rejects.toThrow();
  });

  it.each(['Failed', 'Refunded'])('does not record an explicit %s gateway response as successful delivery', async status => {
    post.mockResolvedValue({ data: [{ message_id: 'm-rejected', status }] });
    await expect(new SmsService().sendAppointmentReminder('+639171234567', appointment)).rejects.toThrow();
    await expect(new SmsService().sendAppointmentChange('+639171234567', { ...appointment, kind: 'cancelled', changedAt })).rejects.toThrow();
  });

  it.each(['Queued', 'Pending', 'Sent'])('accepts a %s message without retrying an accepted request', async status => {
    post.mockResolvedValue({ data: [{ message_id: 'm-accepted', status }] });
    await expect(new SmsService().sendAppointmentReminder('+639171234567', appointment)).resolves.toBeUndefined();
  });
});
