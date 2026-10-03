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
});
