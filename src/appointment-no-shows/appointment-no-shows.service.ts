import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Appointment } from '../appointments/entities/appointment.entity';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { Visit } from '../care/entities/visit.entity';
import { User } from '../users/entities/user.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { ClinicClosure } from '../clinic-closures/entities/clinic-closure.entity';
import { assertOpenInterval } from '../clinic-closures/closure-rules';
import { DentistDayAvailability } from '../dentist-availability/entities/dentist-day-availability.entity';
import { isAvailable } from '../dentist-availability/availability-rules';
import { assignedClinicIds } from '../users/clinic-membership';
import { referenceId } from '../auth/reference-id';
import { manilaDay } from '../care/visit-rules';
import { isDueNoShow } from './no-show-rules';

@Injectable()
export class AppointmentNoShowsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AppointmentNoShowsService.name);
  private timer?: ReturnType<typeof setInterval>; private running = false; private afterId?: Types.ObjectId;
  constructor(@InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
    @InjectModel(Visit.name) private readonly visits: Model<Visit>, @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Clinic.name) private readonly clinics: Model<Clinic>, @InjectModel(ClinicClosure.name) private readonly closures: Model<ClinicClosure>,
    @InjectModel(DentistDayAvailability.name) private readonly days: Model<DentistDayAvailability>,
    private readonly scheduling: AppointmentSchedulingService, private readonly config: ConfigService) {}

  private activation(): Date | undefined {
    if (!this.config.get<boolean>('appointmentNoShows.enabled')) return;
    const value = this.config.get<string>('appointmentNoShows.enforceFrom');
    if (!value || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return;
    return new Date(value);
  }
  onApplicationBootstrap() {
    if (!this.activation()) return;
    this.timer = setInterval(() => void this.tick(), 30_000); this.timer.unref();
    this.logger.log('Prospective automatic No-show handling enabled.'); void this.tick();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private async tick() {
    if (this.running) return; this.running = true;
    try { await this.applyDueNoShows(new Date()); }
    catch { this.logger.error('No-show scan failed; retrying on the next interval.'); }
    finally { this.running = false; }
  }
  async applyDueNoShows(now: Date): Promise<number> {
    const from = this.activation(); if (!from || now < from) return 0;
    // A moving cursor bounds each scan without starving newer rows behind
    // unavailable or arrived appointments. A restart safely rechecks old rows.
    const rows = await this.appointments.find({ status: 'confirmed', isWalkIn: { $ne: true }, disruption: { $exists: false },
      date: { $gte: new Date(manilaDay(from)), $lte: new Date(manilaDay(now)) },
      ...(this.afterId ? { _id: { $gt: this.afterId } } : {}),
    }).select('_id dentist patient').sort({ _id: 1 }).limit(200).lean();
    this.afterId = rows.length === 200 ? rows[rows.length - 1]._id : undefined;
    let applied = 0;
    for (const candidate of rows) {
      try {
        const changed = await this.scheduling.withLocks([referenceId(candidate.patient), referenceId(candidate.dentist)], async session => {
          const current = await this.appointments.findById(candidate._id).session(session);
          if (!current || !isDueNoShow(current, now, from)) return false;
          // If a participant was edited while the scan was in flight, acquire
          // the correct set on the next scan rather than using stale locks.
          if (referenceId(current.patient) !== referenceId(candidate.patient) || referenceId(current.dentist) !== referenceId(candidate.dentist)) return false;
          const clinicId = referenceId(current.clinic), dentistId = referenceId(current.dentist);
          if (!(await this.clinics.updateOne({ _id: clinicId }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false })).matchedCount) return false;
          if (await this.visits.exists({ appointment: current._id }).session(session)) return false;
          const clinic = await this.clinics.findById(clinicId).session(session), dentist = await this.users.findById(dentistId).session(session);
          if (!clinic || !dentist || dentist.status !== 'confirmed' || !assignedClinicIds(dentist).includes(clinicId)) return false;
          const date = current.date.toISOString().slice(0,10), day = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][current.date.getUTCDay()];
          const override = await this.days.findOne({ dentist: dentistId, clinic: clinicId, date, useWeeklyHours: { $ne: true } }).session(session);
          const intervals = override ? override.intervals : (dentist.operatingHours ?? []).filter(row => row.day === day);
          if (!isAvailable(intervals, current.startTime, current.endTime) || (!(clinic.appointmentOnlyDays ?? []).includes(day) &&
            !isAvailable((clinic.operatingHours ?? []).filter(row => row.day === day), current.startTime, current.endTime))) return false;
          const closures = await this.closures.find({ clinic: clinicId, status: 'active' }).session(session);
          try { assertOpenInterval(closures, date, current.startTime, current.endTime); } catch { return false; }
          const result = await this.appointments.updateOne({ _id: current._id, status: 'confirmed', date: current.date,
            startTime: current.startTime, endTime: current.endTime, disruption: { $exists: false }, isWalkIn: { $ne: true } }, {
            $set: { status: 'no_show' }, $push: { history: { action: 'Automatically marked No-show after the 20-minute check-in grace period.', actorRole: 'system', actorName: 'System', timestamp: now } },
          }, { session, runValidators: true });
          return result.modifiedCount === 1;
        });
        if (changed) applied++;
      } catch { this.logger.warn('An appointment could not be checked for No-show; leaving it for review/retry.'); }
    }
    return applied;
  }
}
