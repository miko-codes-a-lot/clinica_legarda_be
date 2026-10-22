import { createHash } from 'crypto';
import { AppointmentStatus } from '../_shared/enum/appointment-status.enum';
import { enterClosureRescheduling } from '../appointments/closure-rescheduling.rules';
import { Visit } from '../care/entities/visit.entity';
import { buildClosureImpact, RecipientCoverage } from './closure-impact';
import { ClosurePreview, ClosurePreviewRow } from './dto/closure-preview.dto';
import { isEmailRecipient } from '../mailer/email-recipient';
import { isSmsRecipient } from '../sms/sms-recipient';
import { PATIENT_RECIPIENT_FIELDS, GUARDIAN_RECIPIENT_FIELDS, PatientRecipientSource, patientRecipient } from '../users/patient-recipient';
import { activePatientScope, requireActivePatient } from '../users/patient-visibility';
import { AppointmentChangeEmail } from '../appointment-change-emails/entities/appointment-change-email.entity';
import { findPatientRecipient } from '../users/patient-recipient';
import { CreateNotificationDto } from '../notifications/dto/create-notification.dto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
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
    @Optional() @InjectModel(AppointmentChangeEmail.name) private readonly outbox?: Model<AppointmentChangeEmail>,
    @Optional() @InjectModel(Visit.name) private readonly visits?: Model<Visit>,
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
    const candidates = await this.appointments.find({ ...await activePatientScope(this.users, session), clinic: referenceId(dto.clinic), status: { $in: ['pending', 'confirmed', 'needs_rescheduling'] },
      date: { $gte: new Date(`${dto.startDate}T00:00:00Z`), $lt: new Date(Date.parse(`${dto.endDate}T00:00:00Z`) + 86400000) },
    }).session(session ?? null).exec();
    return candidates.filter(row => closureOverlaps(dto, row.date.toISOString().slice(0,10), row.startTime, row.endTime));
  }
  private async appointmentRows(ids: unknown[], actor: UserActor, clinic: string, session?: ClientSession): Promise<ClosurePreviewRow[]> {
    type Person = { _id: Types.ObjectId; firstName?: string; middleName?: string; lastName?: string; username?: string };
    type Row = Omit<ClosurePreviewRow, '_id' | 'patient' | 'dentist' | 'clinic' | 'date' | 'services' | 'closureRescheduling'> & {
      _id: Types.ObjectId; patient: Person | null; dentist: Person | null; clinic: { _id: Types.ObjectId; name: string } | null;
      date: Date; services: ({ _id: Types.ObjectId; name: string } | null)[]; closureRescheduling?: { expiresAt?: Date };
    };
    const rows = await this.appointments.find({ ...await activePatientScope(this.users, session), $and: [{ _id: { $in: ids }, clinic: referenceId(clinic) }, this.scope(actor)] })
      .select('_id patient dentist clinic services date startTime endTime status disruption closureRescheduling rescheduleProposal')
      .populate([{ path: 'patient', select: '_id firstName middleName lastName username' }, { path: 'dentist', select: CARE_CLINICIAN_FIELDS },
        { path: 'clinic', select: CARE_CLINIC_FIELDS }, { path: 'services', select: '_id name', options: { retainNullValues: true } }])
      .session(session ?? null).sort({ date: 1, startTime: 1, _id: 1 }).lean<Row[]>().exec();
    return rows.map(row => ({ ...row, _id: row._id.toString(), date: row.date.toISOString(),
      patient: row.patient ? { ...row.patient, _id: row.patient._id.toString() } : null,
      dentist: row.dentist ? { ...row.dentist, _id: row.dentist._id.toString() } : null,
      clinic: row.clinic ? { ...row.clinic, _id: row.clinic._id.toString() } : null,
      services: (row.services ?? []).map(service => service ? { _id: service._id.toString(), name: service.name } : null),
      closureRescheduling: row.closureRescheduling ? { expiresAt: row.closureRescheduling.expiresAt?.toISOString() } : undefined,
    }));
  }
  private async impact(actor: UserActor, dto: ClinicClosureDto, rows: Awaited<ReturnType<ClinicClosuresService['affected']>>, session?: ClientSession): Promise<ClosurePreview> {
    const ids = rows.map(row => row._id);
    const activeVisits = this.visits ? await this.visits.find({ appointment: { $in: ids }, state: { $in: ['waiting', 'in_progress'] } }).select('_id appointment revision state').session(session ?? null).lean() : [];
    const protectedIds = new Set(activeVisits.map(visit => String(visit.appointment)));
    const populated = (await this.appointmentRows(ids, actor, dto.clinic, session)).map(row => ({ ...row, protectedCare: protectedIds.has(row._id) }));
    const patients = await this.users.find({ _id: { $in: rows.map(row => row.patient) } }).select(PATIENT_RECIPIENT_FIELDS)
      .populate({ path: 'guardian', select: GUARDIAN_RECIPIENT_FIELDS }).session(session ?? null).lean<PatientRecipientSource[]>();
    const coverage: RecipientCoverage = {};
    for (const patient of patients) {
      const contact = patientRecipient(patient);
      coverage[String(patient._id)] = { email: isEmailRecipient(contact?.emailAddress), sms: isSmsRecipient(contact?.mobileNumber) };
    }
    const generatedAt = new Date();
    // Include the complete record snapshot, attendance and recipient eligibility; never a browser-owned count.
    const impactToken = createHash('sha256').update(JSON.stringify({
      input: [dto.clinic, dto.startDate, dto.endDate, dto.startTime, dto.endTime, dto.reason.trim()],
      rows: [...rows].sort((a,b) => String(a._id).localeCompare(String(b._id))).map(row => row.toObject()),
      populated, coverage, activeVisits,
    })).digest('hex');
    return { ...buildClosureImpact(populated, coverage, generatedAt), total: rows.length, generatedAt: generatedAt.toISOString(), impactToken };
  }
  async preview(actor: UserActor, dto: ClinicClosureDto): Promise<ClosurePreview> {
    this.staff(actor, dto.clinic); assertClosureRange(dto);
    if (!dto.reason.trim()) throw new BadRequestException('Enter a closure reason.');
    if (!await this.clinics.exists({ _id: referenceId(dto.clinic) })) throw new NotFoundException('Clinic not found.');
    return this.impact(actor, dto, await this.affected(dto));
  }
  async create(actor: UserActor, dto: ClinicClosureDto) {
    this.staff(actor, dto.clinic); assertClosureRange(dto); if (!dto.reason.trim()) throw new BadRequestException('Enter a closure reason.');
    if (!dto.impactToken) throw new BadRequestException('Preview the closure impact before confirming.');
    try {
      const result = await this.closures.db.transaction(async session => {
        await this.lock(referenceId(dto.clinic), session);
        const rows = await this.affected(dto, session);
        const impact = await this.impact(actor, dto, rows, session);
        if (impact.impactToken !== dto.impactToken) throw new ConflictException({ code: 'CLOSURE_PREVIEW_STALE', message: 'Appointments changed. Refresh the closure preview before confirming.' });
        const protectedIds = new Set(impact.appointments.filter(row => row.protectedCare).map(row => row._id));
        const [closure] = await this.closures.create([{ ...dto, reason: dto.reason.trim(), createdBy: referenceId(actor.sub), createdByName: await this.name(actor, session),
          affectedAppointments: rows.map(row => row._id), activeKey: [referenceId(dto.clinic), dto.startDate, dto.endDate, dto.startTime, dto.endTime].join(':') }], { session });
        const now = new Date(Date.now());
        for (const row of rows) {
          const protectedCare = protectedIds.has(row.id);
          const context = enterClosureRescheduling(row, dto.reason, now);
          const deadline = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(context.expiresAt);
          await this.appointments.updateOne({ _id: row._id, status: row.status }, {
            $set: { ...(!protectedCare ? { status: AppointmentStatus.NEEDS_RESCHEDULING, closureRescheduling: context } : {}), disruption: { closures: [...(row.disruption?.closures ?? []), closure._id], dentistAvailability: row.disruption?.dentistAvailability ?? [], flaggedAt: now, message: protectedCare ? `Clinic closed: ${closure.reason}. Staff must review ongoing care; it will not automatically cancel.` : `Clinic closed: ${closure.reason}. Propose a replacement by ${deadline} (Philippine time).` } },
            ...(!protectedCare ? { $unset: { rescheduleProposal: 1 } } : {}),
            $push: { history: { action: protectedCare ? 'Clinic closure requires manual review of ongoing care.' : row.rescheduleProposal ? 'Closure withdrew the proposed schedule; appointment needs rescheduling.' : 'Appointment needs rescheduling due to clinic closure.', reason: closure.reason, actorId: actor.sub, actorRole: actor.role, actorName: await this.name(actor, session) } },
          }, { session });
          if (this.outbox) await this.outbox.create([{
            eventKey: `closure:${closure.id}:${row.id}`, appointment: row._id, patient: row.patient, clinic: row.clinic,
            kind: 'disrupted', protectedCare, ...(!protectedCare ? { proposalDeadline: context.expiresAt } : {}), scheduleVersion: row.scheduleVersion ?? 0,
            schedule: { date: row.date.toISOString().slice(0, 10), startTime: row.startTime, endTime: row.endTime },
            reason: closure.reason,
          }], { session });
        }
        const notices: CreateNotificationDto[] = [];
        for (const row of rows) {
          const protectedCare = protectedIds.has(row.id);
          const deadline = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(enterClosureRescheduling(row, dto.reason, now).expiresAt);
          const recipient = await findPatientRecipient(this.users, row.patient, session);
          notices.push(
          ...(recipient ? [{ recipient: recipient.id, appointment: referenceId(row._id), type: NotificationType.CLINIC_CLOSURE, message: protectedCare ? `Clinic closed: ${closure.reason}. Staff will review ongoing care with you; it will not automatically cancel.` : `${recipient.patientName ? recipient.patientName + ': ' : ''}Your appointment needs rescheduling due to clinic closure: ${closure.reason}. Propose a replacement by ${deadline} (Philippine time) to avoid automatic cancellation.`, link: '/app/my-appointment', triggeredBy: referenceId(actor.sub) }] : []),
          { recipient: referenceId(row.dentist), appointment: referenceId(row._id), type: NotificationType.CLINIC_CLOSURE, message: protectedCare ? `Clinic closure requires manual review of ongoing care: ${closure.reason}.` : `An appointment needs rescheduling due to clinic closure: ${closure.reason}. Propose a replacement by ${deadline} (Philippine time).`, link: `/dentist/appointment/details/${row.id}`, triggeredBy: referenceId(actor.sub) },
          );
        }
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
      await requireActivePatient(this.users, current.patient, session);
      const active = await this.closures.find({ clinic: referenceId(current.clinic), status: 'active' }).session(session);
      assertOpenInterval(active, current.date.toISOString().slice(0,10), current.startTime, current.endTime);
      await this.appointments.updateOne({ _id: current._id }, {
        ...(current.disruption.dentistAvailability?.length ? { $set: { 'disruption.closures': [] } } : { $unset: { disruption: 1 } }),
        $push: { history: { action: 'Closure disruption resolved.', reason: reason.trim(), actorId: actor.sub, actorRole: actor.role, actorName: await this.name(actor, session) } },
      }, { session });
    });
    return { message: 'Closure flag resolved.' };
  }
  availability(clinic: string) { return this.closures.find({ clinic: referenceId(clinic), status: 'active' }).select('_id clinic startDate endDate startTime endTime').sort({ startDate: 1 }).lean().exec(); }
}
