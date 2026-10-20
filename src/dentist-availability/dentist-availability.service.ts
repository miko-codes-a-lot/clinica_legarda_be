import { findPatientRecipient } from '../users/patient-recipient';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserActor } from '../auth/role-policy';
import { referenceId } from '../auth/reference-id';
import { requireCareClinic } from '../care/care-policy';
import { User } from '../users/entities/user.entity';
import { assignedClinicIds } from '../users/clinic-membership';
import { Clinic } from '../clinics/entities/clinic.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { appointmentStart } from '../appointments/appointment-time';
import { Visit } from '../care/entities/visit.entity';
import { Notification, NotificationType } from '../notifications/entities/notification.entity';
import { AppointmentChangeEmail } from '../appointment-change-emails/entities/appointment-change-email.entity';
import { DentistDayAvailability } from './entities/dentist-day-availability.entity';
import { DentistAvailabilityQueryDto, DentistDayAvailabilityDto } from './dto/dentist-day-availability.dto';
import { assertAvailabilityRange, isAvailable, validateIntervals } from './availability-rules';

@Injectable()
export class DentistAvailabilityService {
  constructor(@InjectModel(DentistDayAvailability.name) private readonly days: Model<DentistDayAvailability>,
    @InjectModel(User.name) private readonly users: Model<User>, @InjectModel(Clinic.name) private readonly clinics: Model<Clinic>,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>, @InjectModel(Visit.name) private readonly visits: Model<Visit>,
    @InjectModel(Notification.name) private readonly notices: Model<Notification>, @InjectModel(AppointmentChangeEmail.name) private readonly outbox: Model<AppointmentChangeEmail>,
    private readonly scheduling: AppointmentSchedulingService, private readonly events: EventEmitter2) {}

  private staff(actor: UserActor, dentist: string, clinic: string) {
    requireCareClinic(actor, clinic);
    if (actor.role === 'dentist' && referenceId(actor.sub) !== referenceId(dentist)) throw new ForbiddenException('You can only edit your own availability.');
  }
  private async participants(dentist: string, clinic: string, session?: ClientSession) {
    const person = await this.users.findById(referenceId(dentist)).session(session ?? null);
    const location = await this.clinics.findById(referenceId(clinic)).session(session ?? null);
    if (!location || !person || person.role !== 'dentist' || person.status !== 'confirmed' || !assignedClinicIds(person).includes(referenceId(clinic)))
      throw new NotFoundException('Confirmed dentist is not assigned to this clinic.');
    return { person, location };
  }
  async list(actor: UserActor, dentist: string, query: DentistAvailabilityQueryDto) {
    this.staff(actor, dentist, query.clinic); assertAvailabilityRange(query.from, query.to);
    await this.participants(dentist, query.clinic);
    return this.days.find({ dentist: referenceId(dentist), clinic: referenceId(query.clinic), date: { $gte: query.from, $lte: query.to } }).sort({ date: 1 }).lean();
  }
  async publicDays(dentist: string, query: DentistAvailabilityQueryDto) {
    assertAvailabilityRange(query.from, query.to); await this.participants(dentist, query.clinic);
    return this.days.find({ dentist: referenceId(dentist), clinic: referenceId(query.clinic), date: { $gte: query.from, $lte: query.to }, useWeeklyHours: { $ne: true } })
      .select('date intervals -_id').sort({ date: 1 }).lean();
  }
  private async prepare(dentist: string, date: string, dto: DentistDayAvailabilityDto, session?: ClientSession) {
    assertAvailabilityRange(date, date);
    const { person, location } = await this.participants(dentist, dto.clinic, session);
    const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(date).getUTCDay()];
    const intervals = dto.restoreWeeklyHours ? (person.operatingHours ?? []).filter(row => row.day === day) : validateIntervals(dto.intervals);
    if (!dto.restoreWeeklyHours && !(location.appointmentOnlyDays ?? []).includes(day) && intervals.some(row =>
      !isAvailable((location.operatingHours ?? []).filter(hour => hour.day === day), row.startTime, row.endTime)))
      throw new BadRequestException('Availability must be within clinic operating hours.');
    const current = await this.days.findOne({ dentist: referenceId(dentist), clinic: referenceId(dto.clinic), date }).session(session ?? null);
    if ((current?.revision ?? 0) !== dto.expectedRevision) throw new ConflictException('Availability changed. Reload the day and review it again.');
    return { current, intervals };
  }
  private async candidates(dentist: string, clinic: string, date: string, session?: ClientSession) {
    const rows = await this.appointments.find({ dentist: referenceId(dentist), clinic: referenceId(clinic), date: new Date(date), status: { $in: ['pending', 'confirmed'] } })
      .session(session ?? null).exec();
    const visited = await this.visits.distinct('appointment', { appointment: { $in: rows.map(row => row._id) } }).session(session ?? null);
    return rows.filter(row => appointmentStart(row.date, row.startTime).getTime() > Date.now() && !visited.some(id => String(id) === row.id));
  }
  async preview(actor: UserActor, dentist: string, date: string, dto: DentistDayAvailabilityDto) {
    this.staff(actor, dentist, dto.clinic);
    const { intervals } = await this.prepare(dentist, date, dto);
    const affected = (await this.candidates(dentist, dto.clinic, date)).filter(row => !isAvailable(intervals, row.startTime, row.endTime));
    return { appointments: await this.appointments.find({ _id: { $in: affected.map(row => row._id) } })
      .select('_id date startTime endTime status patient').populate('patient', 'firstName lastName').sort({ startTime: 1 }).lean(), total: affected.length };
  }
  async save(actor: UserActor, dentist: string, date: string, dto: DentistDayAvailabilityDto) {
    this.staff(actor, dentist, dto.clinic);
    const result = await this.scheduling.withLocks([dentist], async session => {
      if (!(await this.clinics.updateOne({ _id: referenceId(dto.clinic) }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false })).matchedCount)
        throw new NotFoundException('Clinic not found.');
      const { current, intervals } = await this.prepare(dentist, date, dto, session);
      const rows = await this.candidates(dentist, dto.clinic, date, session);
      const affected = rows.filter(row => !isAvailable(intervals, row.startTime, row.endTime));
      const expected = affected.map(row => row.id as string).sort();
      const acknowledged = [...new Set((dto.acknowledgedAppointmentIds ?? []).map(referenceId))].sort();
      if (JSON.stringify(expected) !== JSON.stringify(acknowledged)) throw new ConflictException('Review the affected appointments again before saving.');
      const saved = await this.days.findOneAndUpdate({ dentist: referenceId(dentist), clinic: referenceId(dto.clinic), date }, {
        $set: { intervals: dto.restoreWeeklyHours ? [] : intervals, useWeeklyHours: !!dto.restoreWeeklyHours }, $inc: { revision: 1 },
      }, { upsert: !current, new: true, session });
      if (!saved) throw new ConflictException('Availability changed. Reload and try again.');
      const notifications: Notification[] = [];
      for (const row of rows) {
        if (affected.some(item => item.id === row.id)) {
          const sources = [...(row.disruption?.dentistAvailability ?? []).filter(id => String(id) !== saved.id), saved._id];
          await this.appointments.updateOne({ _id: row._id, status: row.status }, {
            $set: { disruption: { closures: row.disruption?.closures ?? [], dentistAvailability: sources, flaggedAt: new Date(), message: 'Clinic or dentist availability affects this appointment. Contact the clinic to arrange the next step.' } },
            $push: { history: { action: 'Appointment affected by dentist availability.', actorId: actor.sub, actorRole: actor.role, actorName: actor.username } },
          }, { session });
          await this.outbox.create([{ eventKey: `availability:${saved.id}:${saved.revision}:${row.id}`, appointment: row._id, patient: row.patient, clinic: row.clinic,
            kind: 'disrupted', scheduleVersion: row.scheduleVersion ?? 0, schedule: { date, startTime: row.startTime, endTime: row.endTime } }], { session });
          const recipient = await findPatientRecipient(this.users, row.patient, session);
          const created = await this.notices.insertMany([
            ...(recipient ? [{ recipient: recipient.id, appointment: row._id, type: NotificationType.APPOINTMENT_STATUS_UPDATED, message: `${recipient.patientName ? recipient.patientName + ': ' : ''}Dentist availability affects your appointment. Contact the clinic to review the schedule.`, link: '/app/my-appointment' }] : []),
            { recipient: referenceId(row.dentist), appointment: row._id, type: NotificationType.APPOINTMENT_STATUS_UPDATED, message: 'An availability change affects an appointment. Review it with clinic staff.', link: `/dentist/appointment/details/${row.id}` },
          ], { session });
          notifications.push(...created);
        } else if (row.disruption?.dentistAvailability?.some(id => String(id) === saved.id)) {
          const remaining = row.disruption.dentistAvailability.filter(id => String(id) !== saved.id);
          await this.appointments.updateOne({ _id: row._id }, {
            ...(remaining.length || row.disruption.closures.length ? { $set: { 'disruption.dentistAvailability': remaining } } : { $unset: { disruption: 1 } }),
            $push: { history: { action: 'Dentist availability disruption resolved.', actorId: actor.sub, actorRole: actor.role, actorName: actor.username } },
          }, { session });
        }
      }
      return { saved, notifications };
    });
    if (result.notifications.length) this.events.emit('notifications.created', result.notifications);
    return result.saved.toObject();
  }
}
