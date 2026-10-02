import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserActor } from '../auth/role-policy';
import { referenceId } from '../auth/reference-id';
import { requireCareClinic } from '../care/care-policy';
import { CARE_CLINIC_FIELDS, CARE_CLINICIAN_FIELDS } from '../care/care-access.service';
import { Clinic } from '../clinics/entities/clinic.entity';
import { User } from '../users/entities/user.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { Notification, NotificationType } from '../notifications/entities/notification.entity';
import { ClinicClosure } from './entities/clinic-closure.entity';
import { ClinicClosureDto } from './dto/clinic-closure.dto';
import { assertClosureRange, assertOpenInterval, closureOverlaps } from './closure-rules';
@Injectable()
export class ClinicClosuresService implements OnModuleInit {
  constructor(@InjectModel(ClinicClosure.name) private readonly closures: Model<ClinicClosure>,
    @InjectModel(Clinic.name) private readonly clinics: Model<Clinic>,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Notification.name) private readonly notifications: Model<Notification>,
    private readonly events: EventEmitter2,
  ) {}
  async onModuleInit() { await this.closures.init(); }
  private staff(actor: UserActor, clinic?: string) {
    if (!['admin', 'super-admin'].includes(actor.role)) throw new ForbiddenException('Only clinic administrators may manage closures.');
    if (clinic) requireCareClinic(actor, clinic);
  }
  private scope(actor: UserActor, clinic?: string) { this.staff(actor, clinic); return clinic ? { clinic: referenceId(clinic) } : actor.role === 'admin' ? { clinic: { $in: (actor.clinics ?? []).map(referenceId) } } : {}; }
  private async lock(clinic: string, session: ClientSession) {
    if (!(await this.clinics.updateOne({ _id: clinic }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false })).matchedCount) throw new NotFoundException('Clinic not found.');
  }
  private async name(actor: UserActor, session?: ClientSession) {
    const person = await this.users.findById(referenceId(actor.sub)).select('firstName lastName username').session(session ?? null).lean();
    if (!person) throw new ForbiddenException('Staff account no longer exists.');
    return [person.firstName, person.lastName].filter(Boolean).join(' ') || person.username;
  }
  private async affected(dto: ClinicClosureDto, session?: ClientSession) {
    const candidates = await this.appointments.find({ clinic: referenceId(dto.clinic), status: { $in: ['pending', 'confirmed'] },
      date: { $gte: new Date(`${dto.startDate}T00:00:00Z`), $lt: new Date(Date.parse(`${dto.endDate}T00:00:00Z`) + 86400000) },
    }).session(session ?? null).exec();
    return candidates.filter(row => closureOverlaps(dto, row.date.toISOString().slice(0,10), row.startTime, row.endTime));
  }
  private appointmentRows(ids: unknown[], actor: UserActor, clinic: string) {
    return this.appointments.find({ $and: [{ _id: { $in: ids }, clinic: referenceId(clinic) }, this.scope(actor)] }).select('_id patient dentist clinic date startTime endTime status disruption')
      .populate([{ path: 'patient', select: '_id firstName lastName username' }, { path: 'dentist', select: CARE_CLINICIAN_FIELDS }, { path: 'clinic', select: CARE_CLINIC_FIELDS }]).sort({ date: 1, startTime: 1 }).lean().exec();
  }
  async preview(actor: UserActor, dto: ClinicClosureDto) {
    this.staff(actor, dto.clinic); assertClosureRange(dto);
    if (!dto.reason.trim()) throw new BadRequestException('Enter a closure reason.');
    if (!await this.clinics.exists({ _id: referenceId(dto.clinic) })) throw new NotFoundException('Clinic not found.');
    const rows = await this.affected(dto); return { appointments: await this.appointmentRows(rows.map(row => row._id), actor, dto.clinic), total: rows.length };
  }
  async create(actor: UserActor, dto: ClinicClosureDto) {
    this.staff(actor, dto.clinic); assertClosureRange(dto); if (!dto.reason.trim()) throw new BadRequestException('Enter a closure reason.');
    try {
      const result = await this.closures.db.transaction(async session => {
        await this.lock(referenceId(dto.clinic), session);
        const rows = await this.affected(dto, session);
        const [closure] = await this.closures.create([{ ...dto, reason: dto.reason.trim(), createdBy: referenceId(actor.sub), createdByName: await this.name(actor, session),
          affectedAppointments: rows.map(row => row._id), activeKey: [referenceId(dto.clinic), dto.startDate, dto.endDate, dto.startTime, dto.endTime].join(':') }], { session });
        const now = new Date();
        for (const row of rows) {
          await this.appointments.updateOne({ _id: row._id, status: { $in: ['pending', 'confirmed'] } }, {
            $set: { disruption: { closures: [...(row.disruption?.closures ?? []), closure._id], flaggedAt: now, message: 'Clinic closure affects this appointment. Contact the clinic to arrange the next step.' } },
            $push: { history: { action: 'Appointment affected by clinic closure.', actorId: actor.sub, actorRole: actor.role, actorName: await this.name(actor, session) } },
          }, { session });
        }
        const notices = rows.flatMap(row => [
          { recipient: referenceId(row.patient), appointment: row._id, type: NotificationType.CLINIC_CLOSURE, message: 'A clinic closure affects your appointment. Contact the clinic to review the schedule.', link: '/app/my-appointment', triggeredBy: referenceId(actor.sub) },
          { recipient: referenceId(row.dentist), appointment: row._id, type: NotificationType.CLINIC_CLOSURE, message: 'A clinic closure affects an appointment in your schedule. Review it with clinic staff.', link: `/dentist/appointment/details/${row.id}`, triggeredBy: referenceId(actor.sub) },
        ]);
        const notifications = notices.length ? await this.notifications.insertMany(notices, { session }) : [];
        return { id: closure.id as string, notifications };
      });
      if (result.notifications.length) this.events.emit('notifications.created', result.notifications);
      return this.findOne(actor, result.id);
    } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 11000) throw new ConflictException('This exact closure is already active.'); throw error; }
  }
  list(actor: UserActor, clinic?: string) { return this.closures.find(this.scope(actor, clinic)).populate({ path: 'clinic', select: CARE_CLINIC_FIELDS }).sort({ startDate: -1 }).lean().exec(); }
  async findOne(actor: UserActor, id: string) {
    const closure = await this.closures.findById(referenceId(id)).populate({ path: 'clinic', select: CARE_CLINIC_FIELDS }).lean();
    if (!closure) throw new NotFoundException('Clinic closure not found.'); this.staff(actor, referenceId(closure.clinic));
    return { closure, appointments: await this.appointmentRows(closure.affectedAppointments, actor, referenceId(closure.clinic)) };
  }
  async reopen(actor: UserActor, id: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('Enter why the clinic is reopening.');
    const initial = await this.closures.findById(referenceId(id)); if (!initial) throw new NotFoundException('Clinic closure not found.');
    this.staff(actor, referenceId(initial.clinic));
    await this.closures.db.transaction(async session => {
      await this.lock(referenceId(initial.clinic), session);
      const changed = await this.closures.updateOne({ _id: initial._id, status: 'active' }, { $set: { status: 'reopened', reopenedAt: new Date(), reopenedBy: referenceId(actor.sub), reopenedByName: await this.name(actor, session), reopenReason: reason.trim() }, $unset: { activeKey: 1 } }, { session });
      if (!changed.modifiedCount) throw new ConflictException('This closure is already reopened.');
    });
    return this.findOne(actor, id);
  }
  async clearDisruption(actor: UserActor, id: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('Enter the resolution reason.');
    const initial = await this.appointments.findById(referenceId(id)); if (!initial) throw new NotFoundException('Appointment not found.');
    this.staff(actor, referenceId(initial.clinic));
    await this.closures.db.transaction(async session => {
      await this.lock(referenceId(initial.clinic), session);
      const current = await this.appointments.findById(initial._id).session(session);
      if (!current?.disruption) throw new ConflictException('This appointment has no unresolved closure flag.');
      const active = await this.closures.find({ clinic: referenceId(current.clinic), status: 'active' }).session(session);
      assertOpenInterval(active, current.date.toISOString().slice(0,10), current.startTime, current.endTime);
      await this.appointments.updateOne({ _id: current._id }, { $unset: { disruption: 1 }, $push: { history: { action: 'Closure disruption resolved.', reason: reason.trim(), actorId: actor.sub, actorRole: actor.role, actorName: await this.name(actor, session) } } }, { session });
    });
    return { message: 'Closure flag resolved.' };
  }
  availability(clinic: string) { return this.closures.find({ clinic: referenceId(clinic), status: 'active' }).select('_id clinic startDate endDate startTime endTime').sort({ startDate: 1 }).lean().exec(); }
}
