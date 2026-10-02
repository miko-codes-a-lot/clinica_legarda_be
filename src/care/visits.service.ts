import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { UserActor } from '../auth/role-policy';
import { referenceId, sameId } from '../auth/reference-id';
import { User } from '../users/entities/user.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { clinicMembershipFilter } from '../users/clinic-membership';
import { CareAccessService, CARE_CLINIC_FIELDS, CARE_CLINICIAN_FIELDS, CARE_PERSON_FIELDS } from './care-access.service';
import { requireCareStaff } from './care-policy';
import { CheckInDto } from './dto/check-in.dto';
import { VisitQueryDto, VisitTransitionDto } from './dto/visit-transition.dto';
import { Visit, VisitDocument } from './entities/visit.entity';
import { assertAppointmentCheckIn, assertIntakePatient, assertQueueTransition, manilaDay } from './visit-rules';

@Injectable()
export class VisitsService implements OnModuleInit {
  constructor(
    private readonly access: CareAccessService,
    @InjectModel(Visit.name) private readonly visits: Model<Visit>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Clinic.name) private readonly clinics: Model<Clinic>,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
  ) {}
  async onModuleInit() { await this.visits.init(); }

  async checkIn(actor: UserActor, dto: CheckInDto) {
    requireCareStaff(actor);
    this.access.requireClinic(actor, dto.clinic);
    if (actor.role === 'dentist' && !sameId(actor.sub, dto.dentist)) throw new ForbiddenException('You can check in only your own patients.');
    const patientId = referenceId(dto.patient);
    const dentistId = referenceId(dto.dentist);
    const clinicId = referenceId(dto.clinic);
    const day = manilaDay();
    try {
      const id = await this.visits.db.transaction(async session => {
        await this.lockParticipants([patientId, dentistId], clinicId, session);
        const patient = await this.access.requirePatient(actor, patientId, clinicId, session);
        assertIntakePatient(patient.status);
        const dentist = await this.users.exists({ _id: dentistId, role: 'dentist', status: 'confirmed', ...clinicMembershipFilter(clinicId) }).session(session);
        if (!dentist) throw new BadRequestException('Select a confirmed dentist assigned to this clinic.');
        let walkIn = dto.isWalkIn ?? !dto.appointment;
        if (dto.appointment) {
          const appointment = await this.appointments.findById(referenceId(dto.appointment)).session(session);
          if (!appointment) throw new NotFoundException('Appointment not found.');
          if (!sameId(appointment.patient, patientId) || !sameId(appointment.clinic, clinicId) || !sameId(appointment.dentist, dentistId))
            throw new BadRequestException('The appointment must belong to this patient, clinic and dentist.');
          assertAppointmentCheckIn(appointment, day);
          walkIn = dto.isWalkIn ?? appointment.isWalkIn;
        } else if (!walkIn) throw new BadRequestException('Unscheduled check-in must be marked as a walk-in.');
        const now = new Date();
        const [visit] = await this.visits.create([{
          patient: patientId, dentist: dentistId, clinic: clinicId,
          ...(dto.appointment ? { appointment: referenceId(dto.appointment) } : {}),
          date: day, checkedInAt: now, purpose: dto.purpose, isWalkIn: walkIn,
          activeKey: `${patientId}:${clinicId}`, createdBy: referenceId(actor.sub),
          events: [{ state: 'waiting', actor: referenceId(actor.sub), at: now }],
        }], { session });
        return visit.id as string;
      });
      return this.findOne(actor, id);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        throw new ConflictException('This patient is already checked in or this appointment already has a visit.');
      throw error;
    }
  }

  private async lockParticipants(ids: string[], clinic: string, session: ClientSession) {
    for (const id of [...new Set(ids)].sort()) {
      const result = await this.users.updateOne({ _id: id }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false });
      if (!result.matchedCount) throw new BadRequestException('Check-in participant no longer exists.');
    }
    const clinicLock = await this.clinics.updateOne({ _id: clinic }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false });
    if (!clinicLock.matchedCount) throw new BadRequestException('Clinic no longer exists.');
  }

  async list(actor: UserActor, query: VisitQueryDto, queue = false) {
    requireCareStaff(actor);
    if (query.patient) await this.access.requirePatient(actor, query.patient, query.clinic);
    return this.populate(this.visits.find({ ...this.access.scope(actor, query.clinic),
      ...(query.patient ? { patient: referenceId(query.patient) } : {}),
      ...(queue || query.date ? { date: query.date ?? manilaDay() } : {}),
    })).sort(queue ? { checkedInAt: 1, _id: 1 } : { checkedInAt: -1, _id: -1 }).lean().exec();
  }

  async findOne(actor: UserActor, id: string) {
    await this.requireVisit(actor, id);
    return this.populate(this.visits.findById(referenceId(id))).lean().exec();
  }

  private populate<T extends { populate: (options: import('mongoose').PopulateOptions[]) => T }>(query: T): T {
    return query.populate([
      { path: 'patient', select: CARE_PERSON_FIELDS },
      { path: 'dentist', select: CARE_CLINICIAN_FIELDS },
      { path: 'clinic', select: CARE_CLINIC_FIELDS },
    ]);
  }

  private async requireVisit(actor: UserActor, id: string, session?: ClientSession): Promise<VisitDocument> {
    requireCareStaff(actor);
    const visit = await this.visits.findById(referenceId(id)).session(session ?? null);
    if (!visit) throw new NotFoundException('Visit not found.');
    if (actor.role === 'admin') this.access.requireClinic(actor, referenceId(visit.clinic));
    if (actor.role === 'dentist' && !sameId(actor.sub, visit.dentist)) throw new ForbiddenException('This visit belongs to another dentist.');
    return visit;
  }

  async transition(actor: UserActor, id: string, dto: VisitTransitionDto) {
    await this.visits.db.transaction(async session => {
      const visit = await this.requireVisit(actor, id, session);
      this.access.requireClinic(actor, referenceId(visit.clinic));
      assertQueueTransition(visit.state, dto.state, actor.role, sameId(actor.sub, visit.dentist), dto.reason);
      const now = new Date();
      const result = await this.visits.updateOne({ _id: visit._id, revision: visit.revision, state: visit.state }, {
        $set: { state: dto.state, ...(dto.state === 'in_progress' ? { startedAt: now } : { endedAt: now }) },
        ...(dto.state === 'cancelled' ? { $unset: { activeKey: 1 } } : {}),
        $inc: { revision: 1 },
        $push: { events: { state: dto.state, at: now, actor: referenceId(actor.sub), ...(dto.reason ? { reason: dto.reason.trim() } : {}) } },
      }, { session });
      if (!result.modifiedCount) throw new ConflictException('The visit changed. Reload and try again.');
    });
    return this.findOne(actor, id);
  }
}
