import { MailerService } from './mailer.service';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

const send = jest.fn();
const mockGmail = { clientId: 'test', clientSecret: 'test', refreshToken: 'test',
  from: 'sender@example.test', sendingPausedUntil: undefined as string | undefined };
jest.mock('googleapis', () => ({ google: {
  auth: { OAuth2: class { setCredentials() {} } },
  gmail: () => ({ users: { messages: { send } } }),
} }));
jest.mock('../_shared/configuration', () => ({ __esModule: true, default: () => ({
  gmail: mockGmail,
}) }));

describe('OTP email identity', () => {
  beforeEach(() => { send.mockReset(); mockGmail.sendingPausedUntil = undefined; });
  afterEach(() => jest.useRealTimers());
  it('encodes the non-ASCII clinic identity in MIME headers without changing the recipient or OTP', async () => {
    send.mockResolvedValue({});
    await new MailerService().sendOtp('patient@clinic-mail.ph', '123456');
    const raw = Buffer.from(send.mock.calls[0][0].requestBody.raw, 'base64url').toString('utf8');
    const subject = raw.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=$/m)?.[1];
    expect(subject).toBeDefined();
    expect(Buffer.from(subject || '', 'base64').toString('utf8')).toBe('Login OTP - R. Nañez Dental Clinic');
    const from = raw.match(/^From: =\?UTF-8\?B\?([^?]+)\?= <sender@example.test>$/m)?.[1];
    expect(Buffer.from(from || '', 'base64').toString('utf8')).toBe('R. Nañez Dental Clinic');
    expect(raw).toContain('To: patient@clinic-mail.ph');
    expect(raw).toContain('123456');
    expect(raw).toContain('R. Nañez Dental Clinic');
  });

  it('sends an escaped appointment reminder with clinic-local date/time and no clinical notes', async () => {
    send.mockResolvedValue({});
    await new MailerService().sendAppointmentReminder('patient@clinic-mail.ph', {
      clinicName: 'Clinic <script>unsafe</script>',
      clinicAddress: 'Address & Building',
      date: '2026-10-10', startTime: '09:30', endTime: '10:00',
    });
    const raw = Buffer.from(send.mock.calls[0][0].requestBody.raw, 'base64url').toString('utf8');
    expect(raw).toContain('To: patient@clinic-mail.ph');
    expect(raw).toContain('October 10, 2026');
    expect(raw).toContain('9:30 AM');
    expect(raw).toContain('10:00 AM');
    expect(raw).toContain('Philippine time');
    expect(raw).toContain('Clinic &lt;script&gt;unsafe&lt;/script&gt;');
    expect(raw).toContain('Address &amp; Building');
    expect(raw).not.toContain('<script>');
  });

  it('rejects recipient header injection before contacting Gmail', async () => {
    await expect(new MailerService().sendAppointmentReminder('patient@clinic-mail.ph\r\nBcc: attacker@example.test', {
      clinicName: 'Clinic', clinicAddress: '', date: '2026-10-10', startTime: '09:30', endTime: '10:00',
    })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('states the exact 20-minute arrival deadline in confirmation and reminder emails', async () => {
    const appointment = { clinicName: 'Clinic', clinicAddress: '', date: '2026-10-21', startTime: '09:00', endTime: '09:15' };
    const mailer = new MailerService();
    await mailer.sendAppointmentChange('patient@clinic-mail.ph', {
      ...appointment, kind: 'confirmed', changedAt: new Date('2026-10-20T00:00:00Z'),
    });
    await mailer.sendAppointmentReminder('patient@clinic-mail.ph', appointment);
    for (const call of send.mock.calls) {
      const raw = Buffer.from(call[0].requestBody.raw, 'base64url').toString('utf8');
      expect(raw).toContain('9:20 AM'); expect(raw).toContain('20 minutes'); expect(raw).toContain('No-show');
    }
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('clearly describes cancellation and availability disruption without claiming confirmation', async () => {
    for (const kind of ['cancelled', 'disrupted'] as const) {
      await new MailerService().sendAppointmentChange('patient@clinic-mail.ph', {
        kind, clinicName: 'Clinic', clinicAddress: '', date: '2026-10-21',
        startTime: '09:00', endTime: '09:30', changedAt: new Date('2026-10-20T00:00:00Z'),
      });
      const raw = Buffer.from(send.mock.calls.at(-1)?.[0].requestBody.raw, 'base64url').toString('utf8');
      expect(raw).toContain(kind === 'cancelled' ? 'has been cancelled' : 'needs a new schedule');
      expect(raw).not.toContain('has been declined');
    }
  });

  it('emails the previous and new reschedule without assuming its later confirmation status', async () => {
    send.mockResolvedValue({});
    await new MailerService().sendAppointmentChange('patient@clinic-mail.ph', {
      kind: 'rescheduled', patientName: '<b>Alice Child</b>', clinicName: 'Clinic & Branch', clinicAddress: 'Test address', date: '2026-10-20', startTime: '11:00', endTime: '11:30',
      previousSchedule: { date: '2026-10-19', startTime: '09:30', endTime: '10:00' }, reason: '<script>Moved</script>', changedAt: new Date('2026-10-13T00:00:00Z'),
    });
    expect(send).toHaveBeenCalledTimes(1);
    const raw = Buffer.from(send.mock.calls[0][0].requestBody.raw, 'base64url').toString('utf8');
    expect(raw).toContain('October 19, 2026'); expect(raw).toContain('October 20, 2026');
    expect(raw).toContain('9:30 AM'); expect(raw).toContain('11:00 AM');
    expect(raw).toContain('latest appointment status'); expect(raw).not.toContain('pending confirmation'); expect(raw).toContain('Philippine time');
    expect(raw).toContain('&lt;b&gt;Alice Child&lt;/b&gt;'); expect(raw).not.toContain('<b>Alice Child</b>');
    expect(raw).toContain('&lt;script&gt;Moved&lt;/script&gt;'); expect(raw).not.toContain('<script>');
  });

  it('emails an appointment rejection without implying it is still booked', async () => {
    send.mockResolvedValue({});
    await new MailerService().sendAppointmentChange('patient@clinic-mail.ph', { kind: 'rejected', clinicName: 'Clinic', clinicAddress: '',
      date: '2026-10-19', startTime: '09:30', endTime: '10:00', reason: 'Dentist unavailable', changedAt: new Date('2026-10-13T00:00:00Z') });
    expect(send).toHaveBeenCalledTimes(1);
    const raw = Buffer.from(send.mock.calls[0][0].requestBody.raw, 'base64url').toString('utf8');
    expect(raw).toContain('has been declined'); expect(raw).toContain('Dentist unavailable'); expect(raw).not.toContain('confirmed appointment');
  });

  const deliveries = [
    (mailer: MailerService, recipient: string) => mailer.sendOtp(recipient, '123456'),
    (mailer: MailerService, recipient: string) => mailer.sendAppointmentReminder(recipient, {
      clinicName: 'Clinic', clinicAddress: '', date: '2026-10-19', startTime: '09:30', endTime: '10:00',
    }),
    (mailer: MailerService, recipient: string) => mailer.sendAppointmentChange(recipient, {
      kind: 'rejected', clinicName: 'Clinic', clinicAddress: '', date: '2026-10-19',
      startTime: '09:30', endTime: '10:00', changedAt: new Date('2026-10-13T00:00:00Z'),
    }),
  ];

  it('rejects a fictional recipient for every email type before contacting Gmail', async () => {
    for (const deliver of deliveries) {
      await expect(deliver(new MailerService(), 'patient@example.test')).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('reports temporary unavailability for every email type while sending is paused', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-13T06:00:00Z'));
    mockGmail.sendingPausedUntil = '2026-10-14T05:55:00Z';
    for (const deliver of deliveries) {
      await expect(deliver(new MailerService(), 'patient@clinic-mail.ph')).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('automatically resumes all email types at the pause deadline without restarting', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-13T06:00:00Z'));
    mockGmail.sendingPausedUntil = '2026-10-14T05:55:00Z';
    const mailer = new MailerService();
    await expect(deliveries[0](mailer, 'patient@clinic-mail.ph')).rejects.toBeInstanceOf(ServiceUnavailableException);
    jest.setSystemTime(new Date('2026-10-14T05:55:00Z'));
    send.mockResolvedValue({});
    for (const deliver of deliveries) await deliver(mailer, 'patient@clinic-mail.ph');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('fails closed when the configured pause deadline is invalid', () => {
    mockGmail.sendingPausedUntil = 'not-a-date';
    expect(() => new MailerService()).toThrow();
  });
  it('asks for patient agreement in the proposal, then confirms only the accepted revised schedule',async()=>{
    const change={clinicName:'Test Clinic',clinicAddress:'',date:'2026-10-26',startTime:'11:00',endTime:'11:30',changedAt:new Date('2026-10-20'),
      previousSchedule:{date:'2026-10-26',startTime:'09:00',endTime:'09:30'},reason:'Dentist schedule changed'};
    await new MailerService().sendAppointmentChange('patient@clinic-mail.ph',{...change,kind:'rescheduled',responseRequired:true});
    const proposal=Buffer.from(send.mock.calls.at(-1)?.[0].requestBody.raw,'base64url').toString('utf8');
    expect(proposal).toContain('accept');expect(proposal).toContain('automatically cancel');expect(proposal).not.toContain('Check in by');
    expect(proposal).toContain('Previous schedule');expect(proposal).toContain('Revised schedule');
    await new MailerService().sendAppointmentChange('patient@clinic-mail.ph',{...change,kind:'confirmed'});
    const accepted=Buffer.from(send.mock.calls.at(-1)?.[0].requestBody.raw,'base64url').toString('utf8');
    expect(accepted).toContain('Your revised appointment is confirmed');expect(accepted).toContain('agreement');
    expect(accepted).toContain('11:20 AM');expect(accepted).not.toContain('not confirmed until');
  });

  it('distinguishes a patient replacement request, clinic acceptance and a fresh replacement deadline', async () => {
    const provider = new MailerService();
    const change = { clinicName: 'Test Clinic', clinicAddress: '', date: '2026-11-04', startTime: '11:00', endTime: '11:30', changedAt: new Date('2026-10-22'),
      previousSchedule: { date: '2026-11-02', startTime: '10:00', endTime: '10:30' } };
    await provider.sendAppointmentChange('patient@clinic-mail.ph', { ...change, kind: 'rescheduled', proposalSide: 'patient' });
    expect(Buffer.from(send.mock.calls.at(-1)?.[0].requestBody.raw, 'base64url').toString('utf8')).toContain('awaiting clinic review');
    expect(Buffer.from(send.mock.calls.at(-1)?.[0].requestBody.raw, 'base64url').toString('utf8')).not.toContain('until you agree');
    await provider.sendAppointmentChange('patient@clinic-mail.ph', { ...change, kind: 'confirmed', proposalSide: 'patient' });
    expect(Buffer.from(send.mock.calls.at(-1)?.[0].requestBody.raw, 'base64url').toString('utf8')).toContain('clinic accepted your proposed');
    expect(Buffer.from(send.mock.calls.at(-1)?.[0].requestBody.raw, 'base64url').toString('utf8')).not.toContain('Your agreement to the clinic');
    await provider.sendAppointmentChange('patient@clinic-mail.ph', { ...change, kind: 'needs_rescheduling', proposalDeadline: new Date('2026-10-29T04:00:00Z'), reason: 'Equipment repairs' });
    expect(Buffer.from(send.mock.calls.at(-1)?.[0].requestBody.raw, 'base64url').toString('utf8')).toContain('October 29, 2026');
    expect(Buffer.from(send.mock.calls.at(-1)?.[0].requestBody.raw, 'base64url').toString('utf8')).toContain('Equipment repairs');
    expect(Buffer.from(send.mock.calls.at(-1)?.[0].requestBody.raw, 'base64url').toString('utf8')).not.toContain('Your appointment was cancelled');
  });

});
