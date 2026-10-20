import { normalizeTo639 } from '../auth/sms.helper';

/** Only a complete Philippine mobile number can receive a text; anything else is skipped, not retried. */
export function isSmsRecipient(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return /^639\d{9}$/.test(normalizeTo639(value));
  } catch {
    return false;
  }
}
