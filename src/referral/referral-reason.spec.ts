import { referralReason } from './referral-reason';
describe('New referral text and legacy history', () => {
  it('trims new text and keeps HTML as literal text rather than interpreting it', () => {
    expect(referralReason('  Patient needs a specialist  ')).toBe('Patient needs a specialist');
    expect(referralReason('<script>literal</script>')).toBe('<script>literal</script>');
  });
  it('rejects missing, blank, short and oversize new reasons', () => {
    for (const reason of [undefined, null, '   ', 'ab', 'a'.repeat(501), 1]) expect(() => referralReason(reason)).toThrow();
  });
  it('preserves an unchanged short legacy code but rejects replacing it with another short code', () => {
    expect(referralReason('X','X')).toBe('X');
    expect(() => referralReason('Y','X')).toThrow();
  });
});
