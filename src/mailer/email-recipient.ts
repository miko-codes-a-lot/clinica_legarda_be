import { isEmail } from 'class-validator';

/** RFC 2606/6761 demo and local domains cannot receive production email. */
export function isEmailRecipient(value: unknown): value is string {
  if (typeof value !== 'string' || !isEmail(value) || /[\r\n]/.test(value)) return false;
  const domain = value.slice(value.lastIndexOf('@') + 1).toLowerCase();
  return !['test', 'example', 'invalid', 'localhost', 'example.com', 'example.net', 'example.org']
    .some(reserved => domain === reserved || domain.endsWith(`.${reserved}`));
}
