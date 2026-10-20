import { FilterQuery, Types } from 'mongoose';
import { Appointment } from './entities/appointment.entity';
import { Visit } from '../care/entities/visit.entity';

/** Active visits always protect attendance; ended visits belong to their schedule. */
export function currentScheduleAttendance(
  appointment: Pick<Appointment, 'date' | 'scheduleVersion'> & {
    _id: Types.ObjectId;
  },
): FilterQuery<Visit> {
  return {
    appointment: appointment._id,
    $or: [
      { state: { $in: ['waiting', 'in_progress'] } },
      { appointmentScheduleVersion: appointment.scheduleVersion ?? 0 },
      {
        appointmentScheduleVersion: { $exists: false },
        date: appointment.date.toISOString().slice(0, 10),
      },
    ],
  };
}
