import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { DentalChart, DentalChartRevision, DentalChartVersion, DentalChartView } from './entities/dental-chart.entity';
import { DentalChartQueryDto, DentalChartSaveDto } from './dental-charts.dto';
import { chartTeeth, toothNumbers } from './chart-rules';
import { User } from '../users/entities/user.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { UserActor } from '../auth/role-policy';
import { referenceId } from '../auth/reference-id';
import { assignedClinicIds } from '../users/clinic-membership';
import { CareAccessService, CARE_CLINIC_FIELDS, CARE_CLINICIAN_FIELDS } from '../care/care-access.service';
import { requireCareClinic, requireCareStaff } from '../care/care-policy';
import { requireClinicalWriter } from '../care/clinical-rules';
import { PatientRecordChangesService } from '../patient-record-changes/patient-record-changes.service';
export interface DentalChartResponse { chart: DentalChartView | null; currentRevision: number; history: DentalChartRevision[]; }
@Injectable()
export class DentalChartsService {
  constructor(@InjectModel(DentalChart.name) private readonly charts: Model<DentalChart>,
    @InjectModel(DentalChartVersion.name) private readonly versions: Model<DentalChartVersion>,
    @InjectModel(User.name) private readonly users: Model<User>, @InjectModel(Clinic.name) private readonly clinics: Model<Clinic>,
    private readonly access: CareAccessService, private readonly audit: PatientRecordChangesService) {}
  clinicsFor(actor: UserActor) {
    requireCareStaff(actor);
    return this.clinics.find(actor.role === 'super-admin' ? {} : { _id: { $in: (actor.clinics ?? []).map(referenceId) } }).select('_id name').sort({ name: 1 }).lean();
  }
  private async scope(actor: UserActor, patient: string, query: DentalChartQueryDto, session?: ClientSession, includeDeleted = false) {
    requireCareStaff(actor); requireCareClinic(actor, query.clinic); toothNumbers(query.dentition);
    await this.access.requirePatient(actor, patient, query.clinic, session, includeDeleted);
    if (query.revision !== undefined && (!Number.isInteger(query.revision) || query.revision < 1)) throw new BadRequestException('Select a valid chart revision.');
    return { patient: referenceId(patient), clinic: referenceId(query.clinic), dentition: query.dentition };
  }
  async read(actor: UserActor, patient: string, query: DentalChartQueryDto, session?: ClientSession): Promise<DentalChartResponse> {
    if (!session) return this.charts.db.transaction(snapshot => this.read(actor, patient, query, snapshot));
    const scope = await this.scope(actor, patient, query, session, true);
    const current = await this.charts.findOne(scope).session(session ?? null).select('revision').lean();
    const chart = query.revision === undefined ? await this.charts.findOne(scope).session(session ?? null)
      .populate([{ path: 'clinic', select: CARE_CLINIC_FIELDS }, { path: 'updatedBy', select: CARE_CLINICIAN_FIELDS }]).lean<DentalChartView>()
      : await this.versions.findOne({ ...scope, revision: query.revision }).session(session ?? null)
        .populate([{ path: 'clinic', select: CARE_CLINIC_FIELDS }, { path: 'updatedBy', select: CARE_CLINICIAN_FIELDS }]).lean<DentalChartView>();
    if (query.revision !== undefined && !chart) throw new NotFoundException('Chart revision not found.');
    const history = await this.versions.find(scope).session(session ?? null).select('revision updatedBy updatedAt')
      .populate({ path: 'updatedBy', select: CARE_CLINICIAN_FIELDS }).sort({ revision: -1 }).limit(25).lean<DentalChartRevision[]>();
    return { chart, currentRevision: current?.revision ?? 0, history };
  }
  async save(actor: UserActor, patient: string, dto: DentalChartSaveDto): Promise<DentalChartResponse> {
    const teeth = chartTeeth(dto.dentition, dto.teeth);
    if (!Number.isInteger(dto.expectedRevision) || dto.expectedRevision < 0) throw new BadRequestException('Expected revision is required.');
    const query = { clinic: referenceId(dto.clinic), dentition: dto.dentition };
    await this.charts.db.transaction(async session => {
      for (const id of [...new Set([referenceId(actor.sub), referenceId(patient)])].sort()) {
        const lock = await this.users.updateOne({ _id: id }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false });
        if (!lock.matchedCount) throw new NotFoundException('Chart participant no longer exists.');
      }
      const storedActor = await this.users.findById(referenceId(actor.sub)).session(session).lean();
      if (!storedActor) throw new NotFoundException('Clinician no longer exists.');
      const currentActor: UserActor = { sub: referenceId(storedActor._id), role: storedActor.role, username: storedActor.username, clinics: assignedClinicIds(storedActor) };
      requireClinicalWriter(currentActor, actor.sub, dto.clinic);
      const clinic = await this.clinics.updateOne({ _id: query.clinic }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false });
      if (!clinic.matchedCount) throw new NotFoundException('Clinic no longer exists.');
      const scope = await this.scope(currentActor, patient, query, session);
      const current = await this.charts.findOne(scope).session(session);
      if ((current?.revision ?? 0) !== dto.expectedRevision) throw new ConflictException('The dental chart changed. Reload the current chart before saving.');
      if (current && JSON.stringify(chartTeeth(current.dentition, current.teeth)) === JSON.stringify(teeth)) return;
      if (!current && !teeth.length) throw new BadRequestException('Enter at least one tooth observation to start a chart.');
      const revision = dto.expectedRevision + 1;
      const values = { ...scope, teeth, revision, updatedBy: referenceId(currentActor.sub), updatedAt: new Date(Date.now()) };
      if (current) await this.charts.updateOne({ _id: current._id, revision: dto.expectedRevision }, { $set: values }, { session, runValidators: true });
      else await this.charts.create([values], { session });
      await this.versions.create([values], { session });
      await this.audit.recordPatientChange(session, { patient, clinicScope: [query.clinic], actor: currentActor, kind: 'dental_chart', fields: ['teeth'], sourceEventId: `chart:${patient}:${query.clinic}:${query.dentition}:${revision}` });
    });
    return this.read(actor, patient, query);
  }
}
