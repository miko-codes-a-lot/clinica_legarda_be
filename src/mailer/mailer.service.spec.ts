import { MailerService } from './mailer.service';

const send = jest.fn();
jest.mock('googleapis', () => ({ google: {
  auth: { OAuth2: class { setCredentials() {} } },
  gmail: () => ({ users: { messages: { send } } }),
} }));
jest.mock('../_shared/configuration', () => ({ __esModule: true, default: () => ({
  gmail: { clientId: 'test', clientSecret: 'test', refreshToken: 'test', from: 'sender@example.test' },
}) }));

describe('OTP email identity', () => {
  beforeEach(() => send.mockReset());
  it('encodes the non-ASCII clinic identity in MIME headers without changing the recipient or OTP', async () => {
    send.mockResolvedValue({});
    await new MailerService().sendOtp('patient@example.test', '123456');
    const raw = Buffer.from(send.mock.calls[0][0].requestBody.raw, 'base64url').toString('utf8');
    const subject = raw.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=$/m)?.[1];
    expect(subject).toBeDefined();
    expect(Buffer.from(subject || '', 'base64').toString('utf8')).toBe('Login OTP - R. Nañez Dental Clinic');
    const from = raw.match(/^From: =\?UTF-8\?B\?([^?]+)\?= <sender@example.test>$/m)?.[1];
    expect(Buffer.from(from || '', 'base64').toString('utf8')).toBe('R. Nañez Dental Clinic');
    expect(raw).toContain('To: patient@example.test');
    expect(raw).toContain('123456');
    expect(raw).toContain('R. Nañez Dental Clinic');
  });

  it('sends an escaped appointment reminder with clinic-local date/time and no clinical notes', async () => {
    send.mockResolvedValue({});
    await new MailerService().sendAppointmentReminder('patient@example.test', {
      clinicName: 'Clinic <script>unsafe</script>',
      clinicAddress: 'Address & Building',
      date: '2026-10-10', startTime: '09:30', endTime: '10:00',
    });
    const raw = Buffer.from(send.mock.calls[0][0].requestBody.raw, 'base64url').toString('utf8');
    expect(raw).toContain('To: patient@example.test');
    expect(raw).toContain('October 10, 2026');
    expect(raw).toContain('9:30 AM');
    expect(raw).toContain('10:00 AM');
    expect(raw).toContain('Philippine time');
    expect(raw).toContain('Clinic &lt;script&gt;unsafe&lt;/script&gt;');
    expect(raw).toContain('Address &amp; Building');
    expect(raw).not.toContain('<script>');
  });

  it('rejects recipient header injection before contacting Gmail', async () => {
    await expect(new MailerService().sendAppointmentReminder('patient@example.test\r\nBcc: attacker@example.test', {
      clinicName: 'Clinic', clinicAddress: '', date: '2026-10-10', startTime: '09:30', endTime: '10:00',
    })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
