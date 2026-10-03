import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/entities/user.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { UserActor } from '../auth/role-policy';
import { CareAccessService, CARE_CLINIC_FIELDS, CARE_CLINICIAN_FIELDS, CARE_PERSON_FIELDS } from './care-access.service';
import { patientSearchFilter, requireCareStaff } from './care-policy';
import { PatientSearchDto } from './dto/patient-search.dto';
import { patientSearchOptions } from './patient-search-options';

@Injectable()
export class PatientRecordsService {
  constructor(
    private readonly access: CareAccessService,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
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
}
