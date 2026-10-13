import { isEmailRecipient } from './email-recipient';

describe('Outgoing email recipients', () => {
  it.each([
    'patient@example.test', 'patient@TEST', 'patient@demo.invalid',
    'patient@demo.example', 'patient@demo.localhost', 'patient@example.com',
    'patient@sub.example.net', 'patient@example.org', 'patient@EXAMPLE.TEST',
    'patient@localhost', 'not-an-email', 'patient@gmail.com\r\nBcc: other@gmail.com',
  ])('rejects reserved or malformed destination %s', recipient => {
    expect(isEmailRecipient(recipient)).toBe(false);
  });

  it.each(['patient@gmail.com', 'patient@clinic-mail.ph', 'patient@example.com.ph', 'patient@myexample.com'])
    ('allows a syntactically valid non-reserved destination %s', recipient => {
      expect(isEmailRecipient(recipient)).toBe(true);
    });
});
