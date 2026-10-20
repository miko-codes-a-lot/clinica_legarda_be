import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { Appointment } from '../appointments/entities/appointment.entity';
import {
  findCurrentReminderAppointment,
  PopulatedAppointment,
  reminderKey,
} from './appointment-reminders.service';

const fixture = () =>
  ({
    _id: new Types.ObjectId('64b000000000000000000001'),
    date: new Date('2026-10-26'),
    startTime: '09:00',
    endTime: '09:30',
    patient: { _id: new Types.ObjectId('64b000000000000000000002') },
    clinic: { _id: new Types.ObjectId('64b000000000000000000003') },
  }) as PopulatedAppointment;
describe('Reminder schedule versions', () => {
  it('preserves legacy reminder keys so enabling version checks cannot replay delivered reminders', () => {
    const expected = createHash('sha256')
      .update(
        '["64b000000000000000000001","2026-10-26","09:00","09:30","64b000000000000000000002","64b000000000000000000003"]',
      )
      .digest('hex');
    const appointment = fixture();
    expect(reminderKey(appointment)).toBe(expected);
    appointment.scheduleVersion = 0;
    expect(reminderKey(appointment)).toBe(expected);
  });
  it('treats a later return to the same slot as a different reminder schedule', () => {
    const appointment = fixture(),
      original = reminderKey(appointment);
    appointment.scheduleVersion = 1;
    const next = reminderKey(appointment);
    appointment.scheduleVersion = 2;
    expect(reminderKey(appointment)).not.toBe(next);
    expect(next).not.toBe(original);
  });
  it('rechecks the scanned positive version before sending a reminder', async () => {
    const query = {
      select: () => query,
      populate: () => query,
      exec: async () => null,
    };
    const findOne = jest.fn(() => query);
    const appointment = fixture();
    appointment.scheduleVersion = 2;
    await findCurrentReminderAppointment(
      { findOne } as unknown as Model<Appointment>,
      appointment,
    );
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleVersion: 2 }),
    );
  });
});
