import { assignedClinicIds } from '../users/clinic-membership';
import { DentalChart } from '../dental-charts/entities/dental-chart.entity';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/entities/user.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { UserActor } from '../auth/role-policy';
import { CareAccessService, CARE_CLINIC_FIELDS, CARE_CLINICIAN_FIELDS, CARE_PERSON_FIELDS } from './care-access.service';
import { patientSearchFilter, requireCareStaff } from './care-policy';
import { PatientSearchDto } from './dto/patient-search.dto';
import { patientSearchOptions } from './patient-search-options';
import { Visit } from './entities/visit.entity';
import { TreatmentCase } from './entities/treatment-case.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { referenceId } from '../auth/reference-id';

@Injectable()
export class PatientRecordsService {
  constructor(
    private readonly access: CareAccessService,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
    @InjectModel(Visit.name) private readonly visits?: Model<Visit>,
    @InjectModel(TreatmentCase.name) private readonly cases?: Model<TreatmentCase>,
    @InjectModel(Clinic.name) private readonly clinics?: Model<Clinic>,
    @InjectModel(DentalChart.name) private readonly charts?: Model<DentalChart>,
  ) {}

  async search(actor: UserActor, query: PatientSearchDto) {
    requireCareStaff(actor);
    const options = patientSearchOptions(query);
    const filter = { $and: [await this.access.patientFilter(actor, query.clinic), patientSearchFilter(query.search), options.filter] };
    const page = query.page ?? 1;
    const pageSize = 20;
    const [items, total] = await Promise.all([
      this.users.find(filter).select(CARE_PERSON_FIELDS).sort(options.sort)
        .skip((page - 1) * pageSize).limit(pageSize).lean().exec(),
      this.users.countDocuments(filter).exec(),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(actor: UserActor, id: string, clinic?: string) {
    requireCareStaff(actor);
    const patient = await this.access.requirePatient(actor, id, clinic);
    const appointments = await this.appointments.find({ patient: patient._id, ...this.access.scope(actor, clinic) })
      .select('_id clinic dentist date startTime endTime status isWalkIn services careCase')
      .populate({ path: 'clinic', select: CARE_CLINIC_FIELDS })
      .populate({ path: 'dentist', select: CARE_CLINICIAN_FIELDS })
      .populate({ path: 'services', select: '_id name' }).sort({ date: -1, startTime: -1 }).lean().exec();
    return { patient, appointments };
  }

  async report(actor: UserActor, id: string, clinic?: string) {
    requireCareStaff(actor);
    if (!this.visits || !this.cases) throw new ServiceUnavailableException('Patient record export is unavailable.');
    return this.appointments.db.transaction(async session => {
      const patient = await this.access.requirePatient(actor, id, clinic, session);
      const scope = { patient: patient._id, ...this.access.scope(actor, clinic) };
      const appointments = await this.appointments.find(scope).select('_id clinic dentist date startTime endTime status isWalkIn services careCase')
        .populate([{ path: 'clinic', select: CARE_CLINIC_FIELDS }, { path: 'dentist', select: CARE_CLINICIAN_FIELDS }, { path: 'services', select: '_id name' }])
        .session(session).sort({ date: -1, startTime: -1 }).lean();
      const visits = await this.visits!.find(scope).populate([{ path: 'clinic', select: CARE_CLINIC_FIELDS }, { path: 'dentist', select: CARE_CLINICIAN_FIELDS }])
        .session(session).sort({ checkedInAt: -1 }).lean();
      const cases = await this.cases!.find(scope).populate([{ path: 'clinic', select: CARE_CLINIC_FIELDS }, { path: 'dentist', select: CARE_CLINICIAN_FIELDS }])
        .session(session).sort({ createdAt: -1 }).lean();
      const memberships = actor.role === 'admin' ? await this.users.findById(patient._id).select('clinic clinics').session(session).lean() : null;
      const chartClinics = [...new Set([...appointments.map(row => referenceId(row.clinic)), ...visits.map(row => referenceId(row.clinic)), ...(memberships ? assignedClinicIds(memberships) : [])])]
        .filter(id => (actor.clinics ?? []).map(referenceId).includes(id));
      const charts = this.charts ? await this.charts.find({ patient: patient._id, ...(clinic ? { clinic: referenceId(clinic) } : actor.role === 'admin' || actor.role === 'dentist' ? { clinic: { $in: chartClinics } } : {}) })
        .populate([{ path: 'clinic', select: CARE_CLINIC_FIELDS }, { path: 'updatedBy', select: CARE_CLINICIAN_FIELDS }]).session(session).sort({ clinic: 1, dentition: 1 }).lean() : [];
      const location = clinic && this.clinics ? await this.clinics.findById(referenceId(clinic)).select('name').session(session) : null;
      return { record: { patient, appointments }, visits, cases, charts, generatedAt: new Date().toISOString(),
        scopeLabel: clinic ? location?.name ?? 'Selected clinic' : actor.role === 'admin' ? 'Assigned clinics' : actor.role === 'dentist' ? 'My authorized patient records' : 'All clinics' };
    });
  }
}
