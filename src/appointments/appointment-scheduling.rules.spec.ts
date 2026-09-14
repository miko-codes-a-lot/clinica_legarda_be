import { BadRequestException } from '@nestjs/common';
import { calendarDay, ScheduleDentist, ScheduleRequest, validateSchedule } from './appointment-scheduling.rules';

describe('Clinic-aware scheduling rules', () => {
  const hours = [{ day: 'monday', startTime: '8:00', endTime: '17:00' }];
  const request: ScheduleRequest = { dentist: 'dentist', patient: 'patient', clinic: 'a', date: new Date('2026-09-21T18:00:00Z'), startTime: '09:00', endTime: '10:00', services: [] };
  const dentist: ScheduleDentist = { role: 'dentist', status: 'confirmed', clinics: ['a', 'b'], operatingHours: hours, appointmentBufferMinutes: 15, maxWorkingMinutesPerDay: 480 };
  const occupied = { dentist: 'dentist', patient: 'other', startTime: '10:15', endTime: '11:15', serviceMinutes: 60 };
  const validate = (changes: Partial<ScheduleRequest> = {}, provider: Partial<ScheduleDentist> = {}) =>
    validateSchedule({ ...request, ...changes }, { ...dentist, ...provider }, hours, 60, []);

  it('books both assigned clinics and uses the absent-only legacy fallback', () => {
    expect(() => validate()).not.toThrow();
    expect(() => validate({ clinic: 'b' })).not.toThrow();
    expect(() => validate({}, { clinics: undefined, clinic: 'a' })).not.toThrow();
    expect(() => validate({}, { clinics: [], clinic: 'a' })).toThrow('not assigned');
    expect(() => validate({ clinic: 'unassigned' })).toThrow('not assigned');
  });
  it.each([{ role: 'user' }, { status: 'pending' }])('requires a confirmed dentist: %j', provider => {
    expect(() => validate({}, provider)).toThrow('confirmed dentist');
  });
  it('intersects clinic and dentist hours with numeric times', () => {
    expect(() => validate()).not.toThrow();
    expect(() => validate({ startTime: '07:00', endTime: '08:00' })).toThrow('dentist operating hours');
    expect(() => validateSchedule(request, dentist, [{ ...hours[0], startTime: '09:30' }], 60, [])).toThrow('clinic operating hours');
    expect(() => validateSchedule(request, dentist, [], 60, [])).toThrow('clinic operating hours');
  });
  it('rejects short or reversed intervals rather than bypassing service duration', () => {
    expect(() => validate({ endTime: '09:30' })).toThrow('cover the selected services');
    expect(() => validate({ endTime: '08:30' })).toThrow(BadRequestException);
  });
  it('enforces buffer on either side while allowing the exact boundary', () => {
    expect(() => validateSchedule(request, dentist, hours, 60, [occupied])).not.toThrow();
    expect(() => validateSchedule(request, dentist, hours, 60, [{ ...occupied, startTime: '10:14' }])).toThrow('buffer');
    expect(() => validateSchedule({ ...request, startTime: '11:29', endTime: '12:29' }, dentist, hours, 60, [occupied])).toThrow('buffer');
    expect(() => validateSchedule({ ...request, startTime: '11:30', endTime: '12:30' }, dentist, hours, 60, [occupied])).not.toThrow();
  });
  it('counts actual durations and every buffer across the dentist day', () => {
    expect(() => validateSchedule(request, { ...dentist, maxWorkingMinutesPerDay: 149 }, hours, 60, [occupied])).toThrow('remaining working time');
    expect(() => validateSchedule(request, { ...dentist, maxWorkingMinutesPerDay: 150 }, hours, 60, [occupied])).not.toThrow();
    expect(() => validateSchedule(request, { ...dentist, maxWorkingMinutesPerDay: 150 }, hours, 60, [{ ...occupied, serviceMinutes: 90 }])).toThrow('remaining working time');
  });
  it('prevents a patient interval overlap with a different dentist', () => {
    expect(() => validateSchedule(request, dentist, hours, 60, [{ ...occupied, dentist: 'other', patient: 'patient', startTime: '09:30' }])).toThrow('Patient already');
  });
  it('keeps UTC calendar date keys independent of the server timezone', () => {
    expect(calendarDay(request.date).toISOString()).toBe('2026-09-21T00:00:00.000Z');
    expect(() => calendarDay(new Date('invalid'))).toThrow(BadRequestException);
  });
});
