import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserActor } from '../auth/role-policy';
import { referenceId } from '../auth/reference-id';
import { Appointment } from '../appointments/entities/appointment.entity';
import { Visit } from './entities/visit.entity';
import { TreatmentCase } from './entities/treatment-case.entity';
import { CARE_CLINIC_FIELDS, CARE_CLINICIAN_FIELDS } from './care-access.service';
import { publicVisitSummary } from './clinical-rules';
@Injectable()
export class PatientCareService {
  constructor(@InjectModel(Visit.name) private readonly visits: Model<Visit>,
    @InjectModel(TreatmentCase.name) private readonly cases: Model<TreatmentCase>,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
  ) {}
  private populate<T extends { populate: (options: import('mongoose').PopulateOptions[]) => T }>(query: T): T {
    return query.populate([{ path: 'clinic', select: CARE_CLINIC_FIELDS }, { path: 'dentist', select: CARE_CLINICIAN_FIELDS }]);
  }
  async ownRecord(actor: UserActor) {
    if (actor.role !== 'user') throw new ForbiddenException('The patient portal is available only to patient accounts.');
    const patient = referenceId(actor.sub);
    const [visits, cases] = await Promise.all([
      this.populate(this.visits.find({ patient, state: 'completed' }).select('_id date clinic dentist purpose careCase summary aftercare nextSteps treatments.description treatments.tooth state')).sort({ date: -1, endedAt: -1 }).lean().exec(),
      this.populate(this.cases.find({ patient }).select('_id clinic dentist title plan status consultationVisit')).sort({ createdAt: -1 }).lean().exec(),
    ]);
    const appointments = await this.populate(this.appointments.find({ patient, careCase: { $in: cases.map(c => c._id) } })
      .select('_id clinic dentist careCase date startTime endTime status')).sort({ date: 1, startTime: 1 }).lean().exec();
    return { visits: visits.map(publicVisitSummary).filter(record => record !== null), cases, appointments };
  }
}
