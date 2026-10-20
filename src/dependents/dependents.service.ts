import { ACTIVE_ACCOUNT, requireActivePatient } from '../users/patient-visibility';
import { PatientRecordChangesService, changedPatientFields, PROFILE_AUDIT_FIELDS } from '../patient-record-changes/patient-record-changes.service';
import { assignedClinicIds } from '../users/clinic-membership';
import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { User } from '../users/entities/user.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { Visit } from '../care/entities/visit.entity';
import { UserActor } from '../auth/role-policy';
import { referenceId, sameId } from '../auth/reference-id';
import { adminClinicIds, adminClinicScope } from '../auth/clinic-policy';
import { clinicMembershipFilter } from '../users/clinic-membership';
import { patientDemographics } from '../users/patient-demographics';
import { UserStatus } from '../_shared/enum/user-status.enum';
import { DependentUpsertDto, LinkGuardianDto } from './dependents.dto';

export const DEPENDENT_FIELDS = '_id firstName middleName lastName birthDate sex status isDependent loginEnabled verificationSource guardian';
export const verifiedParentFilter = { ...ACTIVE_ACCOUNT, role: 'user', status: UserStatus.CONFIRMED, isDependent: { $ne: true }, loginEnabled: { $ne: false }, otpVerifiedAt: { $type: 'date' } };
@Injectable()
export class DependentsService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
    @InjectModel(Visit.name) private readonly visits: Model<Visit>,
    @Optional() private readonly audit?: PatientRecordChangesService) {}
  private async parent(id: string, session?: ClientSession) {
    const parent = await this.users.findOne({ _id: referenceId(id), ...verifiedParentFilter }).session(session ?? null);
    if (!parent) throw new ForbiddenException('A confirmed, email-verified parent account is required.');
    return parent;
  }
  async list(actor: UserActor) {
    if (actor.role !== 'user') throw new ForbiddenException('Use a parent account.');
    await this.parent(actor.sub);
    return this.users.find({ guardian: referenceId(actor.sub), ...ACTIVE_ACCOUNT, role: 'user', isDependent: true, loginEnabled: false }).select(DEPENDENT_FIELDS).sort({ firstName: 1 }).lean();
  }
  private async locks(ids: string[], session: ClientSession) {
    for (const id of [...new Set(ids.map(referenceId))].sort()) {
      const result = await this.users.updateOne({ _id: id, ...ACTIVE_ACCOUNT }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false });
      if (!result.matchedCount) throw new BadRequestException('Account no longer exists.');
    }
  }
  private fields(dto: DependentUpsertDto) {
    const name = (value: unknown, required = true) => {
      if (typeof value !== 'string' || value.trim().length > 100 || (required && !value.trim())) throw new BadRequestException('Enter the child’s name (up to 100 characters per part).');
      return value.trim();
    };
    const details = patientDemographics(dto);
    if (!details.birthDate) throw new BadRequestException('Enter the child’s birth date.');
    return { firstName: name(dto.firstName), middleName: name(dto.middleName ?? '', false), lastName: name(dto.lastName), ...details };
  }
  async create(actor: UserActor, dto: DependentUpsertDto) {
    if (actor.role !== 'user') throw new ForbiddenException('Use a parent account.');
    const fields = this.fields(dto);
    const id = await this.users.db.transaction(async session => {
      await this.locks([actor.sub], session); await this.parent(actor.sub, session);
      const [child] = await this.users.create([{ ...fields, role: 'user', status: UserStatus.CONFIRMED, isDependent: true,
        loginEnabled: false, guardian: referenceId(actor.sub), verificationSource: 'guardian', clinics: [] }], { session });
      return child._id;
    });
    return this.users.findById(id).select(DEPENDENT_FIELDS).lean().orFail();
  }
  private async staffPatient(actor: UserActor, id: string, session: ClientSession) {
    if (!['admin','super-admin'].includes(actor.role)) throw new ForbiddenException('Only administrators may confirm existing patient relationships.');
    await requireActivePatient(this.users, id, session);
    if (actor.role === 'super-admin') return;
    const scope = adminClinicScope(actor);
    const patient = await this.users.findById(id).session(session);
    const assigned = adminClinicIds(actor);
    if (patient && (assignedClinicIds(patient).some(clinic => !assigned.includes(clinic)) || await this.appointments.exists({ patient: id, clinic: { $nin: assigned } }).session(session) || await this.visits.exists({ patient: id, clinic: { $nin: assigned } }).session(session))) throw new ForbiddenException('Only a super administrator may change parent access for a patient shared with other clinics.');
    if (!await this.users.exists({ _id: id, role: 'user', ...clinicMembershipFilter(adminClinicIds(actor)) }).session(session)
      && !await this.appointments.exists({ patient: id, ...scope }).session(session)
      && !await this.visits.exists({ patient: id, ...scope }).session(session)) throw new ForbiddenException('Patient is outside your assigned clinics.');
  }
  async guardianCandidate(actor: UserActor, id: string, emailAddress: string) {
    return this.users.db.transaction(async session => {
      await this.staffPatient(actor, referenceId(id), session);
      return this.users.findOne({ ...verifiedParentFilter, emailAddress: emailAddress.trim(), _id: { $ne: referenceId(id) } }).select('_id firstName lastName emailAddress').session(session).lean();
    });
  }
  async update(actor: UserActor, id: string, dto: DependentUpsertDto) {
    const fields = this.fields(dto);
    return this.users.db.transaction(async session => {
      await this.locks([actor.sub, id], session);
      if (actor.role === 'user') await this.parent(actor.sub, session); else await this.staffPatient(actor, id, session);
      const before = await this.users.findById(referenceId(id)).session(session).lean();
      const child = await this.users.findOneAndUpdate({ _id: referenceId(id), role: 'user', isDependent: true,
        ...(actor.role === 'user' ? { guardian: referenceId(actor.sub) } : {}) }, { $set: fields }, { new: true, session }).select(DEPENDENT_FIELDS).lean();
      if (!child) throw new ForbiddenException('This child is not managed by your account.');
      if (before && this.audit) {
        const after = await this.users.findById(child._id).session(session).lean();
        const fields = after ? changedPatientFields(before, after, PROFILE_AUDIT_FIELDS) : [];
        const clinicScope = [...assignedClinicIds(before), ...(await this.appointments.distinct('clinic', { patient: child._id }).session(session)).map(referenceId), ...(await this.visits.distinct('clinic', { patient: child._id }).session(session)).map(referenceId)]
          .filter(clinic => actor.role !== 'admin' || adminClinicIds(actor).includes(clinic));
        await this.audit.recordPatientChange(session, { patient: referenceId(child._id), clinicScope, actor, kind: 'profile', fields, sourceEventId: `dependent:${child._id}:${randomUUID()}` });
      }
      return child;
    });
  }
  async unlink(actor: UserActor, id: string, expectedGuardian?: string) {
    if (actor.role !== 'user' && !expectedGuardian) throw new BadRequestException('Refresh the current parent relationship before removing it.');
    return this.users.db.transaction(async session => {
      await this.locks([actor.sub, id], session);
      if (actor.role === 'user') await this.parent(actor.sub, session); else await this.staffPatient(actor, id, session);
      const result = await this.users.updateOne({ _id: referenceId(id), role: 'user', isDependent: true,
        guardian: referenceId(actor.role === 'user' ? actor.sub : expectedGuardian) },
      { $unset: { guardian: 1 }, $set: { status: UserStatus.WALK_IN, isWalkIn: true } }, { session });
      if (!result.matchedCount) throw new ForbiddenException('This child is not managed by your account.');
      return { message: 'Parent access removed. The clinic retains the patient’s records.' };
    });
  }
  async link(actor: UserActor, id: string, dto: LinkGuardianDto) {
    if (!dto.confirmExistingPatient || sameId(id, dto.guardian)) throw new BadRequestException('Confirm the existing patient’s parent relationship.');
    return this.users.db.transaction(async session => {
      await this.locks([id, dto.guardian], session); await this.staffPatient(actor, id, session); await this.parent(dto.guardian, session);
      const child = await this.users.findOne({ _id: referenceId(id), role: 'user', ...ACTIVE_ACCOUNT }).session(session);
      if (!child) throw new BadRequestException('Patient not found.');
      if (child.status === UserStatus.REJECTED) throw new BadRequestException('Review this patient’s rejected account status before linking a parent.');
      if (child.guardian && !sameId(child.guardian, dto.guardian)) throw new ConflictException('Remove the current parent relationship before linking another.');
      if (await this.users.exists({ guardian: child._id, isDependent: true, ...ACTIVE_ACCOUNT }).session(session)) throw new ConflictException('An account managing children cannot itself become a dependent.');
      return this.users.findOneAndUpdate({ _id: child._id }, { $set: { guardian: referenceId(dto.guardian), isDependent: true, loginEnabled: false,
        verificationSource: 'guardian', status: UserStatus.CONFIRMED } }, { new: true, session }).select(DEPENDENT_FIELDS).lean();
    });
  }
}
