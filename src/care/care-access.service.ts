import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model } from 'mongoose';
import { UserActor } from '../auth/role-policy';
import { referenceId } from '../auth/reference-id';
import { User } from '../users/entities/user.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { clinicMembershipFilter } from '../users/clinic-membership';
import { careScope, requireCareClinic, requireCareStaff } from './care-policy';
import { Visit } from './entities/visit.entity';

export const CARE_PERSON_FIELDS = '_id firstName middleName lastName username role status isWalkIn emailAddress mobileNumber address';
export const CARE_CLINIC_FIELDS = '_id name address mobileNumber';
export const CARE_CLINICIAN_FIELDS = '_id firstName middleName lastName';

@Injectable()
export class CareAccessService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
    @InjectModel(Visit.name) private readonly visits?: Model<Visit>,
  ) {}

  scope(actor: UserActor, clinic?: string): Record<string, unknown> { return careScope(actor, clinic); }
  requireClinic(actor: UserActor, clinic: string): void { requireCareClinic(actor, clinic); }

  async patientFilter(actor: UserActor, clinic?: string, session?: ClientSession): Promise<FilterQuery<User>> {
    if (actor.role === 'user') return { role: 'user', _id: referenceId(actor.sub) };
    requireCareStaff(actor);
    if (actor.role === 'super-admin' && !clinic) return { role: 'user' };
    const scope = careScope(actor, clinic);
    const patients = (await this.appointments.distinct('patient', scope).session(session ?? null)).map(referenceId);
    if (this.visits) patients.push(...(await this.visits.distinct('patient', scope).session(session ?? null)).map(referenceId));
    if (actor.role === 'dentist') return { role: 'user', _id: { $in: patients } };
    const clinics = clinic ? [referenceId(clinic)] : [...(actor.clinics ?? [])].map(referenceId);
    return { role: 'user', $or: [{ _id: { $in: patients } }, clinicMembershipFilter(clinics)] };
  }

  async requirePatient(actor: UserActor, patient: string, clinic?: string, session?: ClientSession) {
    const id = referenceId(patient);
    const filter = await this.patientFilter(actor, clinic, session);
    const record = await this.users.findOne({ $and: [{ _id: id }, filter] })
      .select(CARE_PERSON_FIELDS).session(session ?? null).lean().exec();
    if (record) return record;
    if (!await this.users.exists({ _id: id, role: 'user' }).session(session ?? null))
      throw new NotFoundException('Patient not found.');
    throw new ForbiddenException('This patient is outside your accessible care records.');
  }
}
