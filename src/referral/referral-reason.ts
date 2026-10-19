import { BadRequestException } from '@nestjs/common';
/** Legacy codes remain readable; only a newly entered value needs new-text validation. */
export function referralReason(value: unknown, unchanged?: string): string {
  if (typeof value !== 'string') throw new BadRequestException('Enter a reason as text.');
  if (unchanged !== undefined && value === unchanged) return unchanged;
  const text = value.trim();
  if (text.length < 3 || text.length > 500) throw new BadRequestException('Enter a reason of 3 to 500 characters.');
  return text;
}
