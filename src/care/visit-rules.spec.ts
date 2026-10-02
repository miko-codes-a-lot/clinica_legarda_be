import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { assertIntakePatient, assertQueueTransition, assertAppointmentCheckIn, manilaDay } from './visit-rules';

describe('identified visit intake and queue rules', () => {
  it('uses Manila calendar date at the UTC boundary', () => {
    expect(manilaDay(new Date('2026-10-02T16:01:00Z'))).toBe('2026-10-03');
    expect(manilaDay(new Date('2026-10-02T15:59:00Z'))).toBe('2026-10-02');
  });
  it('allows confirmed and staff-registered walk-in patients', () => {
    expect(() => assertIntakePatient('confirmed')).not.toThrow();
    expect(() => assertIntakePatient('walk_in')).not.toThrow();
    for (const status of ['pending', 'rejected', undefined]) expect(() => assertIntakePatient(status)).toThrow(BadRequestException);
  });
  it('checks in only confirmed appointments on the actual Manila day', () => {
    expect(() => assertAppointmentCheckIn({ status: 'confirmed', date: new Date('2026-10-03') }, '2026-10-03')).not.toThrow();
    expect(() => assertAppointmentCheckIn({ status: 'pending', date: new Date('2026-10-03') }, '2026-10-03')).toThrow(ConflictException);
    expect(() => assertAppointmentCheckIn({ status: 'confirmed', date: new Date('2026-10-04') }, '2026-10-03')).toThrow(ConflictException);
  });
  it('allows responsible dentists and super admin to start waiting care', () => {
    expect(() => assertQueueTransition('waiting', 'in_progress', 'dentist', true)).not.toThrow();
    expect(() => assertQueueTransition('waiting', 'in_progress', 'super-admin', false)).not.toThrow();
    expect(() => assertQueueTransition('waiting', 'in_progress', 'admin', false)).toThrow(ForbiddenException);
    expect(() => assertQueueTransition('waiting', 'in_progress', 'dentist', false)).toThrow(ForbiddenException);
  });
  it('requires a cancellation reason and staff authority', () => {
    expect(() => assertQueueTransition('waiting', 'cancelled', 'admin', false, 'Patient left')).not.toThrow();
    expect(() => assertQueueTransition('in_progress', 'cancelled', 'dentist', true, 'Patient left')).not.toThrow();
    expect(() => assertQueueTransition('waiting', 'cancelled', 'admin', false, '  ')).toThrow(BadRequestException);
    expect(() => assertQueueTransition('waiting', 'cancelled', 'user', false, 'Left')).toThrow(ForbiddenException);
  });
  it('retains terminal records and requires clinical completion workflow', () => {
    for (const state of ['completed', 'cancelled']) expect(() => assertQueueTransition(state, 'in_progress', 'super-admin', false)).toThrow(ConflictException);
    expect(() => assertQueueTransition('in_progress', 'completed', 'dentist', true)).toThrow(BadRequestException);
    expect(() => assertQueueTransition('in_progress', 'waiting', 'dentist', true)).toThrow(ConflictException);
  });
});
