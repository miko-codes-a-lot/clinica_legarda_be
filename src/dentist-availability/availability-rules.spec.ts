import { assertAvailabilityRange, assertAvailable, validateIntervals } from './availability-rules';

describe('Dated dentist availability', () => {
  const intervals = [{ startTime: '09:00', endTime: '12:00' }, { startTime: '13:00', endTime: '17:00' }];
  it('allows a full service in an interval and excludes the lunch break and whole-day absence', () => {
    expect(() => assertAvailable(intervals, '10:30', '12:00')).not.toThrow();
    expect(() => assertAvailable(intervals, '11:30', '13:00')).toThrow('unavailable');
    expect(() => assertAvailable([], '09:00', '09:30')).toThrow('unavailable');
  });
  it('rejects invalid and overlapping intervals while allowing adjacent ones', () => {
    expect(() => validateIntervals([{ startTime: '12:00', endTime: '11:00' }])).toThrow();
    expect(() => validateIntervals([{ startTime: '25:00', endTime: '26:00' }])).toThrow();
    expect(() => validateIntervals([{ startTime: '09:00', endTime: '12:00' }, { startTime: '11:00', endTime: '13:00' }])).toThrow();
    expect(validateIntervals([{ startTime: '10:00', endTime: '11:00' }, { startTime: '09:00', endTime: '10:00' }])[0].startTime).toBe('09:00');
  });
  it('bounds real calendar date ranges, including leap days', () => {
    expect(() => assertAvailabilityRange('2028-02-29', '2028-03-01')).not.toThrow();
    expect(() => assertAvailabilityRange('2026-02-29', '2026-03-01')).toThrow();
    expect(() => assertAvailabilityRange('2026-10-20', '2026-10-19')).toThrow();
    expect(() => assertAvailabilityRange('2026-01-01', '2028-01-01')).toThrow();
  });
});
