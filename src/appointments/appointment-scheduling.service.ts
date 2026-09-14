import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Appointment } from './entities/appointment.entity';
import { User } from '../users/entities/user.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { DentalCatalog } from '../dental-catalog/entities/dental-catalog.entity';
import { AppointmentStatus } from '../_shared/enum/appointment-status.enum';
import { clinicReferenceId } from '../users/clinic-membership';
import { calendarDay, ScheduleRequest, validateSchedule } from './appointment-scheduling.rules';

export const OCCUPIED_STATUSES = [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED];

@Injectable()
export class AppointmentSchedulingService {
  constructor(
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Clinic.name) private readonly clinics: Model<Clinic>,
    @InjectModel(DentalCatalog.name) private readonly services: Model<DentalCatalog>,
  ) {}

  async withLocks<T>(userIds: string[], work: (session: ClientSession) => Promise<T>): Promise<T> {
    if (userIds.some(id => !Types.ObjectId.isValid(id))) throw new BadRequestException('Invalid scheduling participant');
    const ids = [...new Set(userIds.map(id => new Types.ObjectId(id).toHexString()))].sort();
    return this.appointments.db.transaction(async session => {
      // A write lock before any booking read makes competing transactions retry
      // against fresh data, across server processes. Sorting also protects patients
      // booking different dentists. This internal lock must not update profiles.
      for (const id of ids) {
        const locked = await this.users.updateOne(
          { _id: id }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false },
        ).exec();
        if (!locked.matchedCount) throw new BadRequestException('Scheduling participant no longer exists');
      }
      return work(session);
    });
  }

  async validate(request: ScheduleRequest, session: ClientSession, excludeId?: string, statuses = OCCUPIED_STATUSES): Promise<void> {
    const dentist = await this.users.findById(request.dentist).session(session).exec();
    const clinic = await this.clinics.findById(request.clinic).session(session).exec();
    if (!dentist || !clinic) throw new BadRequestException('Invalid dentist or clinic selected');
    const day = calendarDay(request.date);
    const nextDay = new Date(day.getTime() + 86400000);
    const appointments = await this.appointments.find({
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      $or: [{ dentist: request.dentist }, { patient: request.patient }],
      date: { $gte: day, $lt: nextDay },
      status: { $in: statuses },
    }).session(session).exec();
    const serviceIds = [...new Set([
      ...request.services,
      ...appointments.flatMap(appointment => appointment.services.map(service => clinicReferenceId(service)).filter((id): id is string => !!id)),
    ])];
    const services = await this.services.find({ _id: { $in: serviceIds } }).session(session).exec();
    const durations = new Map(services.map(service => [service.id as string, service.duration]));
    if (request.services.some(id => !durations.has(id))) throw new BadRequestException('Invalid service selected');
    const duration = (ids: string[]) => [...new Set(ids)].reduce((sum, id) => {
      const minutes = durations.get(id) ?? 0;
      if (!Number.isFinite(minutes) || minutes < 0) throw new BadRequestException('Service duration is unavailable');
      return sum + minutes;
    }, 0);
    validateSchedule(request, dentist, clinic.operatingHours, duration([...new Set(request.services)]), appointments.map(appointment => ({
      dentist: clinicReferenceId(appointment.dentist) ?? '',
      patient: clinicReferenceId(appointment.patient) ?? '',
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      serviceMinutes: duration(appointment.services.map(service => clinicReferenceId(service)).filter((id): id is string => !!id)),
    })));
  }
}
