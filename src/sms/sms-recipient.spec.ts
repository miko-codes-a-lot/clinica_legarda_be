import { isSmsRecipient } from './sms-recipient';

describe('SMS recipient', () => {
  it.each(['+639171234567', '639171234567', '09171234567', '9171234567', ' +639171234567 '])(
    'accepts the Philippine mobile number %p', value => {
      expect(isSmsRecipient(value)).toBe(true);
    });

  it.each([
    undefined, null, '', '   ', 639171234567,
    '+63917123456', '+6391712345678', '0281234567', '+14155550123', '0917abc4567',
    '+639171234567,+639181234567', '+639171234567\n+639181234567',
  ])('rejects %p so a worker skips it instead of retrying or texting extra recipients', value => {
    expect(isSmsRecipient(value)).toBe(false);
  });
});
