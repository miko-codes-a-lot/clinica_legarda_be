import { ACTIVE_ACCOUNT, activePatientScope, requireActivePatient } from '../users/patient-visibility';
import { randomUUID } from 'crypto';
import { RescheduleResponseDto } from './dto/reschedule-response.dto';
import { ReferralStatus } from '../_shared/enum/referral-status.enum';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types, UpdateQuery } from 'mongoose';
import {
  Appointment,
  AppointmentDocument,
} from './entities/appointment.entity';
import { AppointmentUpsertDto } from './dto/appointment-upsert.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentAvailabilityDto } from './dto/appointment-availability.dto';
import { AppointmentStatus } from '../_shared/enum/appointment-status.enum';
import { clinicMembershipFilter, clinicReferenceId } from '../users/clinic-membership';
import { User } from '../users/entities/user.entity';
import { adminClinicIds, adminClinicScope, assertClinicAccess, canAccessClinic, visibleClinicMemberships } from '../auth/clinic-policy';
import {
  AppointmentSchedulingService,
  OCCUPIED_STATUSES,
} from './appointment-scheduling.service';
import { Referral } from '../referral/entities/referral.entity';
import { isAdmin, UserActor } from '../auth/role-policy';
import {
  appointmentScope,
  authorizeAppointment,
  referenceId,
  sameId,
} from '../auth/record-policy';
import {
  APPOINTMENT_PERSON_FIELDS,
  DENTIST_DIRECTORY_FIELDS,
} from '../users/user-projections';
import { calendarDay, ScheduleRequest } from './appointment-scheduling.rules';
import { patientBookingStatuses } from '../users/patient-booking-policy';
import { Visit } from '../care/entities/visit.entity';
import { TreatmentCase } from '../care/entities/treatment-case.entity';
import { assertCareCaseLink } from '../care/clinical-rules';
import { AppointmentChangeEmail } from '../appointment-change-emails/entities/appointment-change-email.entity';
import { appointmentStart, reservationDeadline } from './appointment-time';
import { currentScheduleAttendance } from './appointment-attendance';
import { referralReason } from '../referral/referral-reason';

@Injectable()
export class AppointmentsService {
  private expiryAfterId?: Types.ObjectId;
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
    private readonly scheduling: AppointmentSchedulingService,
    @InjectModel(Referral.name) private readonly referralModel: Model<Referral>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(TreatmentCase.name) private readonly careCases?: Model<TreatmentCase>,
    @InjectModel(Visit.name) private readonly visits?: Model<Visit>,
    @InjectModel(AppointmentChangeEmail.name) private readonly changeEmailOutbox?: Model<AppointmentChangeEmail>,
  ) {}

  async create(dto: AppointmentUpsertDto, actor: UserActor) {
    // Only a validated, sender-owned referral may book another dentist.
    // General appointment read/edit/decision authorization remains unchanged.
    const dentistReferral = actor.role === 'dentist' && !sameId(actor.sub, dto.dentist) && !!dto.referral;
    if (!dentistReferral) authorizeAppointment(actor, dto);
    if (dentistReferral && dto.careCase) throw new BadRequestException('A referred appointment cannot reuse the source treatment case.');
    await this.authorizePatient(actor, dto.patient);
    if (
      actor.role === 'dentist' &&
      !(await this.appointmentModel.exists({
        dentist: referenceId(actor.sub),
        patient: referenceId(dto.patient),
      })) && !(this.visits && await this.visits.exists({ dentist: referenceId(actor.sub), patient: referenceId(dto.patient) }))
    ) {
      throw new ForbiddenException(
        'Dentists may book only their established patients.',
      );
    }
    const request = this.writeFields(dto, actor);
    if (dentistReferral) request.notes.clinicNotes = '';
    const id = await this.scheduling.withLocks(
      [request.dentist, request.patient, ...(actor.role === 'user' || dentistReferral ? [actor.sub] : [])],
      async (session) => {
        await this.requireBookablePatient(request.patient, actor, session);
        const validated = await this.scheduling.validate(request, session);
        await this.validateCareCase(request.careCase, validated, session);
        const referral = await this.validateReferral(
          dto.referral,
          validated.patient,
          actor,
          session,
          undefined,
          dentistReferral,
        );
        const [created] = await this.appointmentModel.create(
          [
            {
              ...request,
              ...validated,
              ...(referral && { referral }),
              status: AppointmentStatus.PENDING,
              createdBy: referenceId(actor.sub),
              history: [this.historyEntry('Appointment created.', actor)],
            },
          ],
          { session },
        );
        return created.id as string;
      },
    );
    if (dentistReferral) {
      // The sender may view referral scheduling context, never the receiver's chart/history.
      const created = await this.populate(this.appointmentModel.findById(id).select(
        '_id clinic dentist patient services date startTime endTime status notes.patientNotes referral',
      )).lean().exec();
      if (!created) throw new NotFoundException('Appointment not found.');
      return created;
    }
    return this.findOne(id, actor);
  }

  async availability(dentistId: string, actor: UserActor): Promise<AppointmentAvailabilityDto[]> {
    if (!Types.ObjectId.isValid(dentistId))
      throw new BadRequestException('Invalid dentist ID');
    if (actor.role === 'admin' && !await this.userModel.exists({
      _id: referenceId(dentistId), role: 'dentist', ...clinicMembershipFilter(adminClinicIds(actor)),
    })) throw new ForbiddenException('This dentist is outside your assigned clinics.');
    const appointments = await this.appointmentModel
      .find({
        ...await activePatientScope(this.userModel),
        dentist: dentistId,
        status: { $in: OCCUPIED_STATUSES },
      })
      .select('_id clinic date startTime endTime status')
      .lean()
      .exec();
    return appointments.map((appointment) => ({
      ...(actor.role !== 'admin' || canAccessClinic(actor, appointment.clinic) ? { _id: appointment._id.toString() } : {}),
      date: appointment.date,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      status: appointment.status,
    }));
  }

  async findAll(actor: UserActor, patient?: string, clinic?: string) {
    if (clinic) assertClinicAccess(actor, clinic);
    return this.populate(
      this.appointmentModel.find({
        $and: [
          appointmentScope(actor),
          await activePatientScope(this.userModel),
          patient ? { patient: referenceId(patient) } : {},
          clinic ? { clinic: referenceId(clinic) } : {},
        ],
      }),
    ).exec().then(records => records.map(record => this.visibleAppointment(record, actor)));
  }

  async findAllByDentist(actor: UserActor, dentist: string, clinic?: string) {
    if (clinic) assertClinicAccess(actor, clinic);
    return this.populate(
      this.appointmentModel.find({
        $and: [
          appointmentScope(actor),
          await activePatientScope(this.userModel),
          { dentist: referenceId(dentist) },
          clinic ? { clinic: referenceId(clinic) } : {},
        ],
      }),
    ).exec().then(records => records.map(record => this.visibleAppointment(record, actor)));
  }

  async findOne(id: string, actor: UserActor) {
    const appointment = await this.populate(
      this.appointmentModel.findById(referenceId(id)),
    ).exec();
    if (!appointment) throw new NotFoundException('Appointment not found.');
    authorizeAppointment(actor, appointment);
    return this.visibleAppointment(appointment, actor);
  }

  private visibleAppointment(record: AppointmentDocument, actor: UserActor) {
    if (actor.role !== 'admin') return record;
    const result = record.toJSON();
    // The dentist directory projection also contains memberships. Clamp nested users.
    result.dentist = visibleClinicMemberships(result.dentist, actor);
    return result;
  }

  private async authorizePatient(actor: UserActor, patient: string, session?: ClientSession) {
    const id = referenceId(patient);
    if (actor.role === 'user' && !sameId(id, actor.sub)) {
      const child = await this.userModel.exists({ _id: id, ...ACTIVE_ACCOUNT, role: 'user', isDependent: true, loginEnabled: false, guardian: referenceId(actor.sub) }).session(session ?? null);
      const parent = await this.userModel.exists({ _id: referenceId(actor.sub), ...ACTIVE_ACCOUNT, role: 'user', status: 'confirmed', otpVerifiedAt: { $type: 'date' }, loginEnabled: { $ne: false }, isDependent: { $ne: true } }).session(session ?? null);
      if (!child || !parent) throw new ForbiddenException('This child is not currently managed by your verified parent account.');
    }
    if (actor.role !== 'admin') return;
    const member = await this.userModel.exists({ _id: id, role: 'user', ...clinicMembershipFilter(adminClinicIds(actor)) }).session(session ?? null);
    const history = member || await this.appointmentModel.exists({ patient: id, ...adminClinicScope(actor) }).session(session ?? null)
      || (this.visits && await this.visits.exists({ patient: id, ...adminClinicScope(actor) }).session(session ?? null));
    if (!history) throw new ForbiddenException('This patient is outside your assigned clinics.');
  }

  private async requireBookablePatient(patient: string, actor: UserActor, session: ClientSession) {
    await this.authorizePatient(actor, patient, session);
    const eligible = await this.userModel.exists({
      _id: referenceId(patient), ...ACTIVE_ACCOUNT, role: 'user', status: { $in: patientBookingStatuses(actor.role) },
    }).session(session);
    if (eligible) return;
    if (actor.role === 'user') throw new ForbiddenException('Verify your patient account before booking online. Sign in again and complete the email OTP.');
    throw new BadRequestException('Select a confirmed or staff-registered walk-in patient.');
  }

  private populate<
    T extends {
      populate: (options: import('mongoose').PopulateOptions[]) => T;
    },
  >(query: T): T {
    return query.populate([
      { path: 'clinic' },
      { path: 'services', select: '_id name duration' },
      { path: 'patient', select: APPOINTMENT_PERSON_FIELDS },
      { path: 'dentist', select: DENTIST_DIRECTORY_FIELDS },
      {
        path: 'referral',
        select: '_id fromDoctorId fromClinicId reason reasonOfDecline status',
        populate: [
          { path: 'fromDoctorId', select: APPOINTMENT_PERSON_FIELDS },
          { path: 'fromClinicId' },
        ],
      },
    ]);
  }

  async update(id: string, dto: AppointmentUpsertDto, actor: UserActor) {
    authorizeAppointment(actor, dto);
    await this.withExistingSchedule(
      id,
      actor,
      [dto.dentist, dto.patient],
      async (current, session) => {
        this.requireStatus(current, [AppointmentStatus.PENDING]);
        await this.authorizePatient(actor, dto.patient, session);
        if (
          !isAdmin(actor) &&
          (!sameId(dto.patient, current.patient) ||
            !sameId(dto.dentist, current.dentist) ||
            !sameId(dto.clinic, current.clinic))
        ) {
          throw new ForbiddenException(
            'Only administrators may change appointment identities.',
          );
        }
        const request = this.writeFields(dto, actor, current);
        await this.requireBookablePatient(request.patient, actor, session);
        const referral = await this.validateReferral(
          dto.referral === undefined
            ? current.referral?.toString()
            : dto.referral,
          request.patient,
          actor,
          session,
          id,
        );
        const validated = await this.scheduling.validate(request, session, id);
        await this.validateCareCase(request.careCase, validated, session);
        const scheduleChanged = current.date.getTime() !== validated.date.getTime() || current.startTime !== validated.startTime ||
          current.endTime !== validated.endTime || !sameId(current.clinic, validated.clinic) || !sameId(current.dentist, validated.dentist) || !sameId(current.patient, validated.patient);
        const servicesChanged = current.services.map(String).sort().join(',') !== validated.services.map(String).sort().join(',');
        const detailsChanged = servicesChanged || (current.referral?.toString() ?? '') !== (referral ?? '') ||
          (current.careCase?.toString() ?? '') !== (request.careCase ?? '') || !!current.isWalkIn !== request.isWalkIn;
        if (current.rescheduleProposal && (scheduleChanged || detailsChanged))
          throw new ConflictException('Respond to the current proposal first. Use Reschedule to request a different time, or cancel before changing the booking details.');
        const version = (current.scheduleVersion ?? 0) + (scheduleChanged ? 1 : 0);
        const proposal = scheduleChanged && actor.role !== 'user' && sameId(current.patient, validated.patient)
          ? this.proposal(current, validated, 'Clinic updated the appointment schedule.') : undefined;
        await this.writeCurrent(
          current,
          {
            $set: { ...request, ...validated, referral: referral || null, scheduleVersion: version, ...(proposal ? { rescheduleProposal: proposal } : {}) },
            $unset: { disruption: 1, ...(!proposal && scheduleChanged ? { rescheduleProposal: 1 } : {}) },
            $push: {
              history: this.historyEntry('Appointment details updated.', actor),
            },
          },
          session,
        );
        if (proposal) await this.queueChangeEmail(current, 'rescheduled', this.emailSchedule(validated), actor, session, proposal.reason,
          { patient: validated.patient, clinic: validated.clinic }, { version, proposalId: proposal.id,
            ...(sameId(current.patient, validated.patient) ? { previousSchedule: proposal.previousSchedule } : {}) });
      },
    );
    return this.findOne(id, actor);
  }

  approve(id: string, actor: UserActor) {
    return this.updateStatus(
      id,
      AppointmentStatus.CONFIRMED,
      'Appointment approved.',
      actor,
    );
  }

  async reject(id: string, actor: UserActor, reason: string) {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
      throw new BadRequestException('Enter a rejection reason of up to 500 characters.');
    }
    return this.updateStatus(
      id,
      AppointmentStatus.REJECTED,
      'Appointment rejected.',
      actor,
      reason.trim(),
    );
  }

  complete(id: string, actor: UserActor) {
    return this.updateStatus(
      id,
      AppointmentStatus.COMPLETED,
      'Appointment completed.',
      actor,
    );
  }

  noShow(id: string, actor: UserActor) {
    return this.updateStatus(
      id,
      AppointmentStatus.NO_SHOW,
      'Appointment marked as no show.',
      actor,
    );
  }

  cancel(id: string, actor: UserActor, reason?: string, proposalId?: string) {
    return this.updateStatus(
      id,
      AppointmentStatus.CANCELLED,
      'Appointment cancelled.',
      actor,
      reason,
      proposalId,
    );
  }

  async reschedule(
    id: string,
    dto: RescheduleAppointmentDto,
    actor: UserActor,
  ) {
    await this.withExistingSchedule(id, actor, [], async (current, session) => {
      this.requireStatus(current, [
        AppointmentStatus.PENDING,
        AppointmentStatus.CONFIRMED,
      ]);
      await this.requireNoActiveVisit(current, session);
      const request = {
        ...this.scheduleRequest(current),
        date: calendarDay(dto.date),
        startTime: dto.startTime,
        endTime: dto.endTime,
      };
      await this.requireBookablePatient(request.patient, actor, session);
      const validated = await this.scheduling.validate(request, session, id);
      await this.validateCareCase(current.careCase?.toString(), validated, session);
      this.assertProposal(current, dto.proposalId);
      if (current.rescheduleProposal) this.requireFutureSchedule(current);
      this.requireFutureSchedule(validated);
      if (current.date.getTime() === validated.date.getTime() && current.startTime === validated.startTime && current.endTime === validated.endTime)
        throw new BadRequestException('Choose a different appointment time.');
      const version = (current.scheduleVersion ?? 0) + 1;
      const proposal = actor.role !== 'user' ? this.proposal(current, validated, dto.reason) : undefined;
      await this.writeCurrent(
        current,
        {
          $set: {
            date: validated.date,
            startTime: validated.startTime,
            endTime: validated.endTime,
            status: AppointmentStatus.PENDING, scheduleVersion: version, ...(proposal ? { rescheduleProposal: proposal } : {}),
          },
          $unset: { disruption: 1, ...(!proposal ? { rescheduleProposal: 1 } : {}) },
          $push: {
            history: this.historyEntry(
              'Appointment rescheduled.',
              actor,
              dto.reason,
            ),
          },
        },
        session,
      );
      if (proposal) await this.queueChangeEmail(current, 'rescheduled', this.emailSchedule(validated), actor, session, proposal.reason, undefined,
        { version, proposalId: proposal.id, previousSchedule: proposal.previousSchedule });
    });
    return this.findOne(id, actor);
  }

  async updateDentistNotes(id: string, dentistNotes: string, actor: UserActor) {
    if (typeof dentistNotes !== 'string')
      throw new BadRequestException('Clinical notes must be text.');
    await this.withExistingSchedule(id, actor, [], async (current, session) => {
      authorizeAppointment(actor, current, true);
      await this.appointmentModel
        .findByIdAndUpdate(
          id,
          {
            $set: { 'notes.clinicNotes': dentistNotes },
            $push: {
              history: this.historyEntry('Clinical notes updated.', actor),
            },
          },
          { session, runValidators: true },
        )
        .exec();
    });
    return this.findOne(id, actor);
  }

  /** Narrow referral outcome operation; source dentists receive no general appointment access. */
  async rejectLinkedReferral(
    referralId: string,
    actor: UserActor,
    reasonOfDecline: string,
  ) {
    reasonOfDecline = referralReason(reasonOfDecline);
    const referral = await this.referralModel
      .findById(referenceId(referralId))
      .exec();
    if (!referral) throw new NotFoundException('Referral not found.');
    const appointment = await this.appointmentModel
      .findOne({ referral: referral._id })
      .exec();
    if (
      !isAdmin(actor) &&
      !(
        actor?.role === 'dentist' &&
        (sameId(actor.sub, referral.fromDoctorId) ||
          (appointment && sameId(actor.sub, appointment.dentist)))
      )
    )
      throw new ForbiddenException('You cannot decide this referral.');
    const rejectReferral = (session: ClientSession) =>
      this.referralModel
        .findByIdAndUpdate(
          referralId,
          {
            $set: { status: ReferralStatus.REJECTED, reasonOfDecline },
          },
          { session, runValidators: true },
        )
        .exec();
    if (!appointment) {
      assertClinicAccess(actor, referral.fromClinicId);
      await this.scheduling.withLocks(
        referral.patient ? [referenceId(referral.patient)] : [],
        async (session) => {
          if (referral.patient) await requireActivePatient(this.userModel, referral.patient, session);
          if (
            await this.appointmentModel
              .exists({ referral: referral._id })
              .session(session)
          )
            throw new ConflictException(
              'Referral link changed. Reload and try again.',
            );
          await rejectReferral(session);
        },
      );
      return;
    }
    await this.withExistingSchedule(
      appointment.id,
      actor,
      [],
      async (current, session) => {
        if (!current.referral || !sameId(current.referral, referralId))
          throw new ConflictException('Referral link changed.');
        this.requireStatus(current, [AppointmentStatus.PENDING]);
        await this.writeCurrent(
          current,
          {
            $set: { status: AppointmentStatus.REJECTED },
            $unset: { rescheduleProposal: 1 },
            $push: {
              history: this.historyEntry('Appointment rejected.', actor, reasonOfDecline),
            },
          },
          session,
        );
        await rejectReferral(session);
        await this.queueChangeEmail(current, 'rejected', this.emailSchedule(current), actor, session, reasonOfDecline);
      },
      referral,
    );
  }

  private async updateStatus(
    id: string,
    status: AppointmentStatus,
    historyAction: string,
    actor: UserActor,
    reason?: string,
    proposalId?: string,
  ) {
    if (status === AppointmentStatus.REJECTED) reason = referralReason(reason);
    await this.withExistingSchedule(id, actor, [], async (current, session) => {
      authorizeAppointment(
        actor,
        current,
        status !== AppointmentStatus.CANCELLED,
      );
      if (current.rescheduleProposal && [AppointmentStatus.CONFIRMED, AppointmentStatus.REJECTED].includes(status))
        throw new ConflictException('This schedule is awaiting the patient response. Record their agreement instead of approving it again.');
      if (status === AppointmentStatus.CANCELLED) this.assertProposal(current, proposalId);
      const allowed =
        status === AppointmentStatus.CANCELLED
          ? [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]
          : status === AppointmentStatus.COMPLETED ||
              status === AppointmentStatus.NO_SHOW
            ? [AppointmentStatus.CONFIRMED]
            : [AppointmentStatus.PENDING];
      this.requireStatus(current, allowed);
      if (status === AppointmentStatus.CANCELLED) {
        const staffCancellation = current.status === AppointmentStatus.CONFIRMED &&
          (isAdmin(actor) || actor.role === 'dentist');
        const creator = current.createdBy?.toString() ?? current.history.find(
          entry => entry.action === 'Appointment created.',
        )?.actorId;
        if (!current.rescheduleProposal && !staffCancellation && (!creator || !Types.ObjectId.isValid(creator) || !sameId(creator, actor.sub))) {
          throw new ForbiddenException('Only the person who created this appointment may cancel it.');
        }
        if (!current.rescheduleProposal && Date.now() >= appointmentStart(current.date, current.startTime).getTime()) {
          throw new ConflictException('This appointment has already started. Contact the clinic to resolve its outcome.');
        }
      }
      if (status !== AppointmentStatus.CONFIRMED) await this.requireNoActiveVisit(current, session);
      if (status === AppointmentStatus.NO_SHOW) {
        if (Date.now() < reservationDeadline(current.date, current.startTime).getTime())
          throw new ConflictException('No-show is available only after the 20-minute check-in grace period.');
        if (this.visits && await this.visits.exists(currentScheduleAttendance(current)).session(session))
          throw new ConflictException('This patient attended the current appointment schedule. Resolve its visit before changing the outcome.');
      }
      if (status === AppointmentStatus.COMPLETED && Date.now() < appointmentStart(current.date, current.startTime).getTime())
        throw new ConflictException('An appointment cannot be completed before its scheduled start.');
      if (status === AppointmentStatus.COMPLETED && current.careCase)
        throw new ConflictException('Complete the checked-in clinical visit to finish this treatment session.');
      if (status === AppointmentStatus.CONFIRMED) {
        this.requireResolvedDisruption(current);
        if (Date.now() >= reservationDeadline(current.date, current.startTime).getTime())
          throw new ConflictException('The 20-minute arrival deadline has passed. Reschedule this appointment before approving it.');
        await this.validateCareCase(current.careCase?.toString(), this.scheduleRequest(current), session);
        await this.scheduling.validate(
          this.scheduleRequest(current),
          session,
          id,
          [AppointmentStatus.CONFIRMED],
        );
      }
      await this.writeCurrent(
        current,
        {
          $set: { status },
          $unset: { rescheduleProposal: 1 },
          $push: { history: this.historyEntry(historyAction, actor, reason) },
        },
        session,
      );
      if ([AppointmentStatus.CONFIRMED, AppointmentStatus.REJECTED, AppointmentStatus.CANCELLED].includes(status)) {
        await this.queueChangeEmail(current, status as 'confirmed' | 'rejected' | 'cancelled', this.emailSchedule(current), actor, session, reason);
      }
    });
    return this.findOne(id, actor);
  }

  private assertProposal(current: Appointment, id?: string) {
    if (current.rescheduleProposal?.id !== id) throw new ConflictException('The proposed schedule changed. Reload the appointment before responding.');
  }

  private requireResolvedDisruption(current: Appointment): void {
    if (current.disruption)
      throw new ConflictException('This appointment needs clinic review. Resolve the disruption or reschedule before confirming it.');
  }

  private requireFutureSchedule(schedule: Pick<Appointment, 'date' | 'startTime'>) {
    if (appointmentStart(schedule.date, schedule.startTime).getTime() <= Date.now())
      throw new ConflictException('This time has already started. Choose another future appointment time.');
  }

  private proposal(current: Appointment, schedule: Pick<Appointment, 'date' | 'startTime'>, reason?: string) {
    this.requireFutureSchedule(schedule);
    return { id: randomUUID(), proposedAt: new Date(), previousSchedule: current.rescheduleProposal?.previousSchedule ?? this.emailSchedule(current),
      reason: reason?.trim() || 'Clinic requested a different appointment time.' };
  }

  async respondToReschedule(id: string, dto: RescheduleResponseDto, actor: UserActor) {
    await this.withExistingSchedule(id, actor, [], async (current, session) => {
      this.requireStatus(current, [AppointmentStatus.PENDING]); this.assertProposal(current, dto.proposalId);
      const proposal = current.rescheduleProposal;
      if (!proposal) throw new ConflictException('There is no active reschedule proposal.');
      if (actor.role === 'user') {
        if (dto.method !== 'patient_portal') throw new ForbiddenException('Patients must respond through their own account.');
      } else {
        if (dto.method === 'patient_portal') throw new ForbiddenException('Record phone or in-person patient agreement; do not accept as the patient.');
        if (!dto.reason?.trim() || dto.reason.trim().length < 3) throw new BadRequestException('Explain how the patient agreed to this schedule.');
      }
      this.requireFutureSchedule(current);
      this.requireResolvedDisruption(current);
      await this.requireBookablePatient(referenceId(current.patient), actor, session);
      await this.requireNoActiveVisit(current, session);
      const validated = await this.scheduling.validate(this.scheduleRequest(current), session, id);
      await this.validateCareCase(current.careCase?.toString(), validated, session);
      await this.writeCurrent(current, { $set: { status: AppointmentStatus.CONFIRMED }, $unset: { rescheduleProposal: 1 },
        $push: { history: this.historyEntry(actor.role === 'user' ? 'Patient accepted the proposed schedule.' :
          `Patient agreement recorded (${dto.method === 'phone' ? 'phone' : 'in person'}).`, actor, dto.reason) } }, session);
      await this.queueChangeEmail(current, 'confirmed', this.emailSchedule(current), actor, session, proposal.reason, undefined,
        { previousSchedule: proposal.previousSchedule, patientAcceptance: actor.role === 'user' });
    });
    return this.findOne(id, actor);
  }

  async expireRescheduleProposals(now: Date): Promise<number> {
    const rows = await this.appointmentModel.find({ status: AppointmentStatus.PENDING, rescheduleProposal: { $exists: true },
      date: { $lte: new Date(now.getTime() + 8 * 60 * 60_000) }, ...(this.expiryAfterId ? { _id: { $gt: this.expiryAfterId } } : {})
    }).select('_id patient dentist').sort({ _id: 1 }).limit(100).lean().exec();
    this.expiryAfterId = rows.length === 100 ? rows[rows.length - 1]._id : undefined;
    let expired = 0;
    for (const row of rows) {
      const changed = await this.scheduling.withLocks([referenceId(row.patient), referenceId(row.dentist)], async session => {
        const current = await this.appointmentModel.findById(row._id).session(session).exec();
        if (!current || current.status !== AppointmentStatus.PENDING || !current.rescheduleProposal ||
          !sameId(current.patient, row.patient) || !sameId(current.dentist, row.dentist) || appointmentStart(current.date, current.startTime).getTime() > now.getTime()) return false;
        await this.requireNoActiveVisit(current, session);
        const reason = 'Automatically cancelled because there was no response to the proposed schedule before its start time.';
        await this.writeCurrent(current, { $set: { status: AppointmentStatus.CANCELLED }, $unset: { rescheduleProposal: 1 },
          $push: { history: { action: 'Unanswered reschedule proposal automatically cancelled.', reason, actorRole: 'system', actorName: 'System', timestamp: now } } }, session);
        await this.queueChangeEmail(current, 'cancelled', this.emailSchedule(current), { sub: 'system', role: 'system' }, session, reason);
        return true;
      });
      if (changed) expired++;
    }
    return expired;
  }

  private requireStatus(current: Appointment, allowed: AppointmentStatus[]) {
    if (!allowed.includes(current.status)) {
      throw new ConflictException(
        `This action is not allowed for a ${current.status} appointment.`,
      );
    }
  }

  private emailSchedule(appointment: Pick<Appointment, 'date' | 'startTime' | 'endTime'>) {
    return { date: appointment.date.toISOString().slice(0, 10), startTime: appointment.startTime, endTime: appointment.endTime };
  }

  private async queueChangeEmail(current: AppointmentDocument, kind: 'confirmed' | 'rescheduled' | 'rejected' | 'cancelled',
    schedule: { date: string; startTime: string; endTime: string }, actor: UserActor, session: ClientSession, reason?: string,
    target?: { patient: string; clinic: string },
    notice?: { version?: number; proposalId?: string; previousSchedule?: { date: string; startTime: string; endTime: string }; patientAcceptance?: boolean }) {
    if ((actor.role === 'user' && kind !== 'cancelled' && !notice?.patientAcceptance) || !this.changeEmailOutbox) return;
    await this.changeEmailOutbox.create([{
      eventKey: `${current._id.toString()}:${current.history.length + 1}:${kind}`,
      appointment: current._id, patient: new Types.ObjectId(target?.patient ?? referenceId(current.patient)),
      clinic: new Types.ObjectId(target?.clinic ?? referenceId(current.clinic)), kind, schedule,
      scheduleVersion: notice?.version ?? current.scheduleVersion ?? 0, ...(notice?.proposalId ? { proposalId: notice.proposalId } : {}),
      ...(notice?.previousSchedule ? { previousSchedule: notice.previousSchedule } :
        kind === 'rescheduled' && (!target || sameId(current.patient, target.patient)) ? { previousSchedule: this.emailSchedule(current) } : {}), reason: reason?.trim(),
    }], { session });
  }

  private historyEntry(action: string, actor: UserActor, reason?: string) {
    return {
      action,
      ...(reason !== undefined && { reason: reason.trim() }),
      actorId: referenceId(actor.sub),
      actorRole: actor.role,
      ...(actor.username && { actorName: actor.username }),
    };
  }

  private async requireNoActiveVisit(current: AppointmentDocument, session: ClientSession) {
    if (this.visits && await this.visits.exists({ appointment: current._id, state: { $in: ['waiting', 'in_progress'] } }).session(session))
      throw new ConflictException('This appointment is checked in. Resolve its queue visit before changing the appointment.');
  }

  private async validateCareCase(value: string | undefined, request: { patient: string; dentist: string; clinic: string }, session: ClientSession) {
    if (!value) return;
    const careCase = this.careCases && await this.careCases.findById(referenceId(value)).session(session);
    if (!careCase) throw new BadRequestException('Treatment case not found.');
    assertCareCaseLink(careCase, request);
  }

  /** State and history are one conditional write inside the participant transaction. */
  private async writeCurrent(
    current: AppointmentDocument,
    update: UpdateQuery<Appointment>,
    session: ClientSession,
  ) {
    const updated = await this.appointmentModel
      .findOneAndUpdate({ _id: current._id, status: current.status }, update, {
        session,
        runValidators: true,
      })
      .exec();
    if (!updated)
      throw new ConflictException('Appointment changed. Reload and try again.');
  }

  private writeFields(
    dto: AppointmentUpsertDto,
    actor: UserActor,
    current?: Appointment,
  ) {
    const clinical = isAdmin(actor) || actor.role === 'dentist';
    if (!clinical && dto.isWalkIn !== undefined && dto.isWalkIn !== (current?.isWalkIn ?? false)) {
      throw new ForbiddenException('Only clinic staff may mark a visit as walk-in.');
    }
    const careCase = dto.careCase ?? current?.careCase?.toString();
    return {
      ...(careCase ? { careCase: referenceId(careCase) } : {}),
      isWalkIn: clinical ? dto.isWalkIn ?? current?.isWalkIn ?? false : current?.isWalkIn ?? false,
      clinic: dto.clinic,
      patient: referenceId(dto.patient),
      dentist: dto.dentist,
      services:
        dto.services ?? (current ? this.scheduleRequest(current).services : []),
      date: calendarDay(dto.date),
      startTime: dto.startTime,
      endTime: dto.endTime,
      notes: {
        patientNotes:
          dto.notes?.patientNotes ?? current?.notes?.patientNotes ?? '',
        clinicNotes: clinical
          ? (dto.notes?.clinicNotes ?? current?.notes?.clinicNotes ?? '')
          : (current?.notes?.clinicNotes ?? ''),
      },
    };
  }

  private async validateReferral(
    value: string | undefined,
    patient: string,
    actor: UserActor,
    session: ClientSession,
    appointmentId?: string,
    requireSender = false,
  ) {
    if (!value) return undefined;
    const id = referenceId(value);
    const referral = await this.referralModel
      .findById(id)
      .session(session)
      .exec();
    if (!referral) throw new BadRequestException('Referral not found.');
    if (requireSender && (
      !sameId(referral.fromDoctorId, actor.sub) ||
      !await this.userModel.exists({ _id: referenceId(actor.sub), ...ACTIVE_ACCOUNT, role: 'dentist', status: 'confirmed' }).session(session) ||
      !await this.appointmentModel.exists({ patient: referenceId(patient), dentist: referenceId(actor.sub), clinic: referral.fromClinicId }).session(session)
    )) throw new ForbiddenException('Only the established referring dentist may schedule this referral.');
    const linked = await this.appointmentModel
      .findOne({ referral: id })
      .session(session)
      .exec();
    if (linked) {
      if (
        !appointmentId ||
        !sameId(linked._id, appointmentId) ||
        !sameId(linked.patient, patient)
      )
        throw new ForbiddenException('Referral is already linked.');
      return id;
    }
    if (referral.status === ReferralStatus.REJECTED)
      throw new BadRequestException('Rejected referrals cannot be linked.');
    assertClinicAccess(actor, referral.fromClinicId);
    if (
      !referral.patient ||
      !sameId(referral.patient, patient) ||
      !referral.createdBy ||
      (!isAdmin(actor) && !sameId(referral.createdBy, actor.sub))
    ) {
      throw new ForbiddenException('You cannot link this referral.');
    }
    return id;
  }

  private scheduleRequest(appointment: Appointment): ScheduleRequest {
    const dentist = clinicReferenceId(appointment.dentist);
    const patient = clinicReferenceId(appointment.patient);
    const clinic = clinicReferenceId(appointment.clinic);
    if (!dentist || !patient || !clinic)
      throw new BadRequestException('Appointment participants are unavailable');
    return {
      dentist,
      patient,
      clinic,
      date: appointment.date,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      services: appointment.services
        .map((service) => clinicReferenceId(service))
        .filter((id): id is string => !!id),
    };
  }

  private async withExistingSchedule<T>(
    id: string,
    actor: UserActor,
    proposedUserIds: string[],
    work: (current: AppointmentDocument, session: ClientSession) => Promise<T>,
    sourceReferral?: Referral,
  ): Promise<T> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid appointment ID');
    const snapshot = await this.appointmentModel.findById(id).exec();
    if (!snapshot)
      throw new NotFoundException(`Appointment with ID "${id}" not found.`);
    const authorize = (record: Appointment) => {
      if (
        sourceReferral &&
        actor?.role === 'dentist' &&
        sameId(sourceReferral.fromDoctorId, actor.sub)
      )
        return;
      authorizeAppointment(actor, record);
    };
    authorize(snapshot);
    const before = this.scheduleRequest(snapshot);
    return this.scheduling.withLocks(
      [before.dentist, before.patient, ...proposedUserIds, ...(actor.role === 'user' ? [actor.sub] : [])],
      async (session) => {
        const current = await this.appointmentModel
          .findById(id)
          .session(session)
          .exec();
        if (!current)
          throw new NotFoundException(`Appointment with ID "${id}" not found.`);
        authorize(current);
        await requireActivePatient(this.userModel, current.patient, session);
        await this.authorizePatient(actor, referenceId(current.patient), session);
        const after = this.scheduleRequest(current);
        if (
          before.dentist !== after.dentist ||
          before.patient !== after.patient
        ) {
          throw new ConflictException(
            'Appointment participants changed. Reload and try again.',
          );
        }
        return work(current, session);
      },
    );
  }
}
