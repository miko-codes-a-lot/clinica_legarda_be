import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { UserActor } from '../auth/role-policy';
import { referenceId, sameId } from '../auth/reference-id';
import { Appointment } from '../appointments/entities/appointment.entity';
import { User } from '../users/entities/user.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { Visit } from './entities/visit.entity';
import { TreatmentCase, TreatmentCaseDocument } from './entities/treatment-case.entity';
import { CareAccessService, CARE_CLINIC_FIELDS, CARE_CLINICIAN_FIELDS, CARE_PERSON_FIELDS } from './care-access.service';
import { requireCareStaff } from './care-policy';
import { requireClinicalWriter } from './clinical-rules';
import { TreatmentCaseDto, TreatmentCaseQueryDto, TreatmentCaseStatusDto } from './dto/treatment-case.dto';

@Injectable()
export class TreatmentCasesService implements OnModuleInit {
  constructor(
    private readonly access: CareAccessService,
    @InjectModel(TreatmentCase.name) private readonly cases: Model<TreatmentCase>,
    @InjectModel(Visit.name) private readonly visits: Model<Visit>,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Clinic.name) private readonly clinics: Model<Clinic>,
  ) {}
  async onModuleInit() { await this.cases.init(); }

  async create(actor: UserActor, dto: TreatmentCaseDto) {
    requireCareStaff(actor);
    if (!dto.title.trim() || !dto.plan.trim()) throw new BadRequestException('Enter a case title and patient-facing plan.');
    try {
      const id = await this.cases.db.transaction(async session => {
        const visit = await this.visits.findById(referenceId(dto.consultationVisit)).session(session);
        if (!visit) throw new NotFoundException('Consultation visit not found.');
        requireClinicalWriter(actor, visit.dentist, visit.clinic);
        await this.lockParticipants(visit, session);
        if (visit.purpose !== 'consultation' || !['in_progress', 'completed'].includes(visit.state))
          throw new ConflictException('Start or complete the consultation before creating a treatment case.');
        if (visit.careCase) throw new ConflictException('This consultation already has a treatment case.');
        const [careCase] = await this.cases.create([{
          patient: visit.patient, clinic: visit.clinic, dentist: visit.dentist, consultationVisit: visit._id,
          title: dto.title.trim(), plan: dto.plan.trim(), internalNotes: dto.internalNotes?.trim() ?? '', createdBy: referenceId(actor.sub),
        }], { session });
        const linked = await this.visits.updateOne({ _id: visit._id, revision: visit.revision, careCase: { $exists: false } }, {
          $set: { careCase: careCase._id }, $inc: { revision: 1 },
          $push: { events: { state: 'case_created', at: new Date(), actor: referenceId(actor.sub) } },
        }, { session });
        if (!linked.modifiedCount) throw new ConflictException('The consultation changed. Reload and try again.');
        return careCase.id as string;
      });
      return this.findOne(actor, id);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) throw new ConflictException('This consultation already has a treatment case.');
      throw error;
    }
  }

  private async lockParticipants(record: { patient: unknown; dentist: unknown; clinic: unknown }, session: ClientSession) {
    for (const id of [...new Set([referenceId(record.patient), referenceId(record.dentist)])].sort()) {
      const locked = await this.users.updateOne({ _id: id }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false });
      if (!locked.matchedCount) throw new ConflictException('Case participant no longer exists.');
    }
    const locked = await this.clinics.updateOne({ _id: referenceId(record.clinic) }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false });
    if (!locked.matchedCount) throw new ConflictException('Case clinic no longer exists.');
  }

  private async requireCase(actor: UserActor, id: string, session?: ClientSession): Promise<TreatmentCaseDocument> {
    requireCareStaff(actor);
    const record = await this.cases.findById(referenceId(id)).session(session ?? null);
    if (!record) throw new NotFoundException('Treatment case not found.');
    if (actor.role === 'admin') this.access.requireClinic(actor, referenceId(record.clinic));
    if (actor.role === 'dentist' && !sameId(actor.sub, record.dentist)) throw new ForbiddenException('This case belongs to another dentist.');
    return record;
  }

  private populate<T extends { populate: (options: import('mongoose').PopulateOptions[]) => T }>(query: T): T {
    return query.populate([{ path: 'patient', select: CARE_PERSON_FIELDS }, { path: 'dentist', select: CARE_CLINICIAN_FIELDS }, { path: 'clinic', select: CARE_CLINIC_FIELDS }]);
  }

  async list(actor: UserActor, query: TreatmentCaseQueryDto) {
    requireCareStaff(actor);
    if (query.patient) await this.access.requirePatient(actor, query.patient, query.clinic);
    return this.populate(this.cases.find({ ...this.access.scope(actor, query.clinic), ...(query.patient ? { patient: referenceId(query.patient) } : {}) })).sort({ createdAt: -1 }).lean().exec();
  }
  async findOne(actor: UserActor, id: string) {
    const record = await this.requireCase(actor, id);
    const [careCase, visits, appointments] = await Promise.all([
      this.populate(this.cases.findById(record._id)).lean().exec(),
      this.visits.find({ careCase: record._id }).select('_id date purpose state summary checkedInAt endedAt').sort({ checkedInAt: 1 }).lean().exec(),
      this.appointments.find({ careCase: record._id }).select('_id date startTime endTime status services').populate({ path: 'services', select: '_id name' }).sort({ date: 1 }).lean().exec(),
    ]);
    return { careCase, visits, appointments };
  }
  async close(actor: UserActor, id: string, dto: TreatmentCaseStatusDto) {
    await this.cases.db.transaction(async session => {
      const record = await this.requireCase(actor, id, session);
      requireClinicalWriter(actor, record.dentist, record.clinic);
      await this.lockParticipants(record, session);
      if (record.status !== 'active' || record.revision !== dto.revision) throw new ConflictException('The treatment case changed or is already closed.');
      if (await this.visits.exists({ careCase: record._id, state: { $in: ['waiting', 'in_progress'] } }).session(session)
        || await this.appointments.exists({ careCase: record._id, status: { $in: ['pending', 'confirmed'] } }).session(session))
        throw new ConflictException('Finish or cancel outstanding visits and appointments before closing this case.');
      const changed = await this.cases.updateOne({ _id: record._id, revision: dto.revision, status: 'active' }, {
        $set: { status: dto.status, closedBy: referenceId(actor.sub), closedAt: new Date() }, $inc: { revision: 1 },
      }, { session });
      if (!changed.modifiedCount) throw new ConflictException('The treatment case changed. Reload before saving.');
    });
    return this.findOne(actor, id);
  }
}
