import { BadRequestException } from '@nestjs/common';
import { appointmentStart, reservationDeadline } from './appointment-time';

describe('Appointment Manila timing', () => {
  it('interprets the stored calendar date and local start, including midnight rollover', () => {
    expect(appointmentStart(new Date('2026-10-21'), '09:00').toISOString()).toBe('2026-10-21T01:00:00.000Z');
    expect(appointmentStart(new Date('2026-10-21'), '00:10').toISOString()).toBe('2026-10-20T16:10:00.000Z');
  });
  it('sets the reservation deadline 20 minutes after the start', () => {
    expect(reservationDeadline(new Date('2026-10-21'), '09:00').toISOString()).toBe('2026-10-21T01:20:00.000Z');
  });
  it('rejects malformed dates or times rather than enabling an action', () => {
    expect(() => appointmentStart(new Date('invalid'), '09:00')).toThrow(BadRequestException);
    expect(() => appointmentStart(new Date('2026-10-21'), '25:00')).toThrow(BadRequestException);
  });
});
