import { AppointmentStatus } from '../../_shared/enum/appointment-status.enum';

/** Public scheduling contract. No populated appointment or patient data. */
export class AppointmentAvailabilityDto {
  _id: string;
  date: Date;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
}
