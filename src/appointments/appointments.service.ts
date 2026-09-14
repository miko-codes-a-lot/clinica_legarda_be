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
import { clinicReferenceId } from '../users/clinic-membership';
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

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
    private readonly scheduling: AppointmentSchedulingService,
    @InjectModel(Referral.name) private readonly referralModel: Model<Referral>,
  ) {}

  async create(dto: AppointmentUpsertDto, actor: UserActor) {
    authorizeAppointment(actor, dto);
    if (
      actor.role === 'dentist' &&
      !(await this.appointmentModel.exists({
        dentist: referenceId(actor.sub),
        patient: referenceId(dto.patient),
      }))
    ) {
      throw new ForbiddenException(
        'Dentists may book only their established patients.',
      );
    }
    const request = this.writeFields(dto, actor);
    const id = await this.scheduling.withLocks(
      [request.dentist, request.patient],
      async (session) => {
        const validated = await this.scheduling.validate(request, session);
        const referral = await this.validateReferral(
          dto.referral,
          validated.patient,
          actor,
          session,
        );
        const [created] = await this.appointmentModel.create(
          [
            {
              ...request,
              ...validated,
              ...(referral && { referral }),
              status: AppointmentStatus.PENDING,
              history: [this.historyEntry('Appointment created.', actor)],
            },
          ],
          { session },
        );
        return created.id as string;
      },
    );
    return this.findOne(id, actor);
  }

  async availability(dentistId: string): Promise<AppointmentAvailabilityDto[]> {
    if (!Types.ObjectId.isValid(dentistId))
      throw new BadRequestException('Invalid dentist ID');
    const appointments = await this.appointmentModel
      .find({
        dentist: dentistId,
        status: { $in: OCCUPIED_STATUSES },
      })
      .select('_id date startTime endTime status')
      .lean()
      .exec();
    return appointments.map((appointment) => ({
      _id: appointment._id.toString(),
      date: appointment.date,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      status: appointment.status,
    }));
  }

  findAll(actor: UserActor, patient?: string, clinic?: string) {
    return this.populate(
      this.appointmentModel.find({
        $and: [
          appointmentScope(actor),
          patient ? { patient: referenceId(patient) } : {},
          clinic ? { clinic: referenceId(clinic) } : {},
        ],
      }),
    ).exec();
  }

  findAllByDentist(actor: UserActor, dentist: string, clinic?: string) {
    return this.populate(
      this.appointmentModel.find({
        $and: [
          appointmentScope(actor),
          { dentist: referenceId(dentist) },
          clinic ? { clinic: referenceId(clinic) } : {},
        ],
      }),
    ).exec();
  }

  async findOne(id: string, actor: UserActor) {
    const appointment = await this.populate(
      this.appointmentModel.findById(referenceId(id)),
    ).exec();
    if (!appointment) throw new NotFoundException('Appointment not found.');
    authorizeAppointment(actor, appointment);
    return appointment;
  }

  private populate<
    T extends {
      populate: (options: import('mongoose').PopulateOptions[]) => T;
    },
  >(query: T): T {
    return query.populate([
      { path: 'clinic' },
      { path: 'services' },
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
    await this.withExistingSchedule(
      id,
      actor,
      [dto.dentist, dto.patient],
      async (current, session) => {
        this.requireStatus(current, [AppointmentStatus.PENDING]);
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
        await this.writeCurrent(
          current,
          {
            $set: { ...request, ...validated, referral: referral || null },
            $push: {
              history: this.historyEntry('Appointment details updated.', actor),
            },
          },
          session,
        );
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

  reject(id: string, actor: UserActor) {
    return this.updateStatus(
      id,
      AppointmentStatus.REJECTED,
      'Appointment rejected.',
      actor,
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

  cancel(id: string, actor: UserActor, reason?: string) {
    return this.updateStatus(
      id,
      AppointmentStatus.CANCELLED,
      'Appointment cancelled.',
      actor,
      reason,
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
      const request = {
        ...this.scheduleRequest(current),
        date: calendarDay(dto.date),
        startTime: dto.startTime,
        endTime: dto.endTime,
      };
      const validated = await this.scheduling.validate(request, session, id);
      await this.writeCurrent(
        current,
        {
          $set: {
            date: validated.date,
            startTime: validated.startTime,
            endTime: validated.endTime,
            status: AppointmentStatus.PENDING,
          },
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
      await this.scheduling.withLocks(
        referral.patient ? [referenceId(referral.patient)] : [],
        async (session) => {
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
            $push: {
              history: this.historyEntry('Appointment rejected.', actor),
            },
          },
          session,
        );
        await rejectReferral(session);
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
  ) {
    await this.withExistingSchedule(id, actor, [], async (current, session) => {
      authorizeAppointment(
        actor,
        current,
        status !== AppointmentStatus.CANCELLED,
      );
      const allowed =
        status === AppointmentStatus.CANCELLED
          ? [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]
          : status === AppointmentStatus.COMPLETED ||
              status === AppointmentStatus.NO_SHOW
            ? [AppointmentStatus.CONFIRMED]
            : [AppointmentStatus.PENDING];
      this.requireStatus(current, allowed);
      if (status === AppointmentStatus.CONFIRMED) {
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
          $push: { history: this.historyEntry(historyAction, actor, reason) },
        },
        session,
      );
    });
    return this.findOne(id, actor);
  }

  private requireStatus(current: Appointment, allowed: AppointmentStatus[]) {
    if (!allowed.includes(current.status)) {
      throw new ConflictException(
        `This action is not allowed for a ${current.status} appointment.`,
      );
    }
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
    return {
      clinic: dto.clinic,
      patient: actor.role === 'user' ? referenceId(actor.sub) : dto.patient,
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
  ) {
    if (!value) return undefined;
    const id = referenceId(value);
    const referral = await this.referralModel
      .findById(id)
      .session(session)
      .exec();
    if (!referral) throw new BadRequestException('Referral not found.');
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
      [before.dentist, before.patient, ...proposedUserIds],
      async (session) => {
        const current = await this.appointmentModel
          .findById(id)
          .session(session)
          .exec();
        if (!current)
          throw new NotFoundException(`Appointment with ID "${id}" not found.`);
        authorize(current);
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
