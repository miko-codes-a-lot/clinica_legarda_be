import { ForbiddenException, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppointmentStatus } from 'src/_shared/enum/appointment-status.enum';
import { ReferralStatus } from 'src/_shared/enum/referral-status.enum';
import { Appointment } from 'src/appointments/entities/appointment.entity';
import { Referral } from 'src/referral/entities/referral.entity';
import { appointmentScope, referenceId } from '../auth/record-policy';
import { isAdmin, UserActor } from '../auth/role-policy';
import { assertClinicAccess } from '../auth/clinic-policy';
import { reportPeriod, ReportQuery } from './report-period';
import { PatientRecordChangesService } from '../patient-record-changes/patient-record-changes.service';
import { adminClinicIds } from '../auth/clinic-policy';
import {
  DailyQueueResponse,
  WeeklySummaryResponse,
  WeeklyTrendResponse,
  ClinicAnalyticsReport,
} from './report-responses';

type Period = ReturnType<typeof reportPeriod>;
interface ServiceName {
  name: string;
}
interface ReportAppointment {
  _id: Types.ObjectId;
  referral?: Types.ObjectId;
  date: Date;
  status: AppointmentStatus;
  services: ServiceName[];
}
interface QueueAppointment {
  _id: Types.ObjectId;
  startTime: string;
  patient: { firstName?: string; lastName?: string } | null;
  clinic: { _id: Types.ObjectId; name: string };
  services: ServiceName[];
}

function reportScope(
  clinicId: string,
  actor: UserActor,
): Record<string, unknown> {
  if (!isAdmin(actor) && actor?.role !== 'dentist') {
    throw new ForbiddenException('You cannot access appointment reports.');
  }
  if (clinicId !== 'all') assertClinicAccess(actor, clinicId);
  return { $and: [appointmentScope(actor), clinicId === 'all' ? {} : { clinic: referenceId(clinicId) }] };
}

function serviceNames(services: ServiceName[]): string[] {
  return [...new Set(services.map((service) => service.name).filter(Boolean))];
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
    @InjectModel(Referral.name) private readonly referralModel: Model<Referral>,
    @Optional() private readonly recordChanges?: PatientRecordChangesService,
  ) {}

  async getReport(clinicId: string, actor: UserActor, query: ReportQuery = {}): Promise<ClinicAnalyticsReport> {
    // The combined patient-record audit report is an administrator capability.
    // Existing dentist-only appointment report endpoints retain their ownership rules.
    if (!isAdmin(actor)) throw new ForbiddenException('Only administrators may access combined clinic reports.');
    const scope = reportScope(clinicId, actor), period = reportPeriod(new Date(Date.now()), query);
    if (!this.recordChanges) throw new ServiceUnavailableException('Patient record reporting is unavailable.');
    const coverageFrom = await this.recordChanges.coverage();
    const auditScope = clinicId !== 'all' ? { clinicScope: referenceId(clinicId) } : actor.role === 'admin'
      ? { clinicScope: { $in: adminClinicIds(actor) } } : { 'clinicScope.0': { $exists: true } };
    return this.appointmentModel.db.transaction(async session => {
      const records = await this.appointmentModel.find({ ...scope, date: { $gte: period.appointmentStart, $lt: period.appointmentEnd } })
        .select('date status services patient').populate('services', '_id name').session(session).lean();
      const changes = await this.recordChanges!.inPeriod(auditScope, period.updateStart, period.updateEnd, session);
      const empty = () => Array<number>(period.bucketKeys.length).fill(0);
      const appointments = empty(), completed = empty(), noShow = empty(), counts = empty();
      const statuses: Record<string, number> = Object.fromEntries(Object.values(AppointmentStatus).map(status => [status, 0]));
      const preferredServices = new Map<string, number>(), serviceTrend = new Map<string, number[]>();
      const bucket = (date: string) => period.bucketKeys.indexOf(date.slice(0, period.kind === 'year' ? 7 : 10));
      for (const record of records) {
        const index = bucket(record.date.toISOString()); if (index < 0) continue;
        appointments[index]++; statuses[record.status] = (statuses[record.status] ?? 0) + 1;
        if (record.status === AppointmentStatus.COMPLETED) completed[index]++;
        if (record.status === AppointmentStatus.NO_SHOW) noShow[index]++;
        const services = new Map(record.services.filter(Boolean).map(service => [referenceId(service), service.name]));
        for (const name of services.values()) {
          if (!name) continue;
          preferredServices.set(name, (preferredServices.get(name) ?? 0) + 1);
          const trend = serviceTrend.get(name) ?? empty(); trend[index]++; serviceTrend.set(name, trend);
        }
      }
      for (const change of changes) {
        const localDate = new Date(change.createdAt.getTime() + 8 * 60 * 60 * 1000).toISOString(), index = bucket(localDate);
        if (index >= 0) counts[index]++;
      }
      const completedCount = statuses[AppointmentStatus.COMPLETED], noShowCount = statuses[AppointmentStatus.NO_SHOW];
      return { clinicId, generatedAt: new Date(Date.now()).toISOString(),
        period: { kind: period.kind, anchor: period.anchor, start: period.start, end: period.end, bucketKeys: period.bucketKeys, labels: period.labels },
        totalAppointments: records.length, uniquePatients: new Set(records.map(row => referenceId(row.patient))).size, statuses,
        completed: completedCount, noShow: noShowCount, completedShare: records.length ? completedCount / records.length : 0,
        noShowRate: completedCount + noShowCount ? noShowCount / (completedCount + noShowCount) : 0,
        preferredServices: Object.fromEntries(preferredServices), trend: { appointments, completed, noShow, serviceTrend: Object.fromEntries(serviceTrend) },
        patientRecordChanges: { events: changes.length, patients: new Set(changes.map(row => row.patient.toString())).size, counts, coverageFrom },
        metricDefinitions: { completedShare: 'Completed appointments / all appointments in the selected period.',
          noShowRate: 'No-show rate among resolved outcomes: No-show / (completed + No-show).',
          patientRecordChanges: 'Actual patient profile edits, visit record changes and dental chart revisions recorded since audit activation. Treatment case creation or closure, unchanged saves, sign-in activity and appointment updates are excluded. Historical changes have not been reconstructed.' } };
    });
  }

  private weeklyAppointments(
    scope: Record<string, unknown>,
    period: Period,
  ): Promise<ReportAppointment[]> {
    // Model queries cast the shared scope's string ObjectIds, unlike aggregate matches.
    return this.appointmentModel
      .find({
        ...scope,
        date: { $gte: period.appointmentStart, $lt: period.appointmentEnd },
      })
      .select('_id date status services referral')
      .populate('services', 'name')
      .lean<ReportAppointment[]>()
      .exec();
  }

  async getWeeklySummary(
    clinicId: string,
    actor: UserActor,
  ): Promise<WeeklySummaryResponse> {
    const scope = reportScope(clinicId, actor);
    const period = reportPeriod();
    const [appointments, appointmentsUpdated] = await Promise.all([
      this.weeklyAppointments(scope, period),
      this.appointmentModel
        .countDocuments({
          ...scope,
          updatedAt: { $gte: period.updateStart, $lt: period.updateEnd },
        })
        .exec(),
    ]);
    // Bookings persist Appointment.referral; the legacy reverse field and source clinic are not authoritative.
    const declined = await this.referralModel
      .find({
        status: ReferralStatus.REJECTED,
        _id: {
          $in: appointments.flatMap((appointment) =>
            appointment.referral ? [appointment.referral] : [],
          ),
        },
      })
      .select('reasonOfDecline')
      .lean()
      .exec();
    const declinedReferrals = new Map<string, number>();
    for (const referral of declined) {
      const reason = referral.reasonOfDecline?.trim() || 'Unspecified';
      declinedReferrals.set(reason, (declinedReferrals.get(reason) ?? 0) + 1);
    }
    const preferredServices = new Map<string, number>();
    for (const appointment of appointments) {
      for (const name of serviceNames(appointment.services)) {
        preferredServices.set(name, (preferredServices.get(name) ?? 0) + 1);
      }
    }
    return {
      weekOf: period.weekOf,
      weekEnd: period.weekEnd,
      today: period.today,
      totalAppointments: appointments.length,
      appointmentsUpdated,
      preferredServices: Object.fromEntries(preferredServices),
      declinedReferrals: Object.fromEntries(declinedReferrals),
    };
  }

  async getWeeklyAppointmentTrend(
    clinicId: string,
    actor: UserActor,
  ): Promise<WeeklyTrendResponse> {
    const scope = reportScope(clinicId, actor);
    const period = reportPeriod();
    const records = await this.weeklyAppointments(scope, period);
    const appointments = Array<number>(7).fill(0);
    const completed = Array<number>(7).fill(0);
    const serviceTrend = new Map<string, number[]>();
    for (const record of records) {
      const day = period.dateKeys.indexOf(
        record.date.toISOString().slice(0, 10),
      );
      appointments[day]++;
      if (record.status === AppointmentStatus.COMPLETED) completed[day]++;
      for (const name of serviceNames(record.services)) {
        const series = serviceTrend.get(name) ?? Array<number>(7).fill(0);
        series[day]++;
        serviceTrend.set(name, series);
      }
    }
    return {
      weekOf: period.weekOf,
      weekEnd: period.weekEnd,
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      appointments,
      completed,
      serviceTrend: Object.fromEntries(serviceTrend),
    };
  }

  async getDailyAppointmentQueue(
    clinicId: string,
    actor: UserActor,
  ): Promise<DailyQueueResponse[]> {
    const scope = reportScope(clinicId, actor);
    const period = reportPeriod();
    const queue = await this.appointmentModel
      .find({
        ...scope,
        date: { $gte: period.todayStart, $lt: period.todayEnd },
        status: AppointmentStatus.CONFIRMED,
      })
      .select('_id startTime patient services clinic')
      .populate('patient', 'firstName lastName')
      .populate('services', 'name')
      .populate({
        path: 'clinic',
        select: 'name',
        transform: (
          doc: QueueAppointment['clinic'] | null,
          id: Types.ObjectId,
        ) => doc ?? { _id: id, name: 'Unknown clinic' },
      })
      .sort({ startTime: 1, _id: 1 })
      .lean<QueueAppointment[]>()
      .exec();
    return queue.map((appointment) => ({
      appointmentId: appointment._id.toHexString(),
      time: appointment.startTime,
      patientName:
        [appointment.patient?.firstName, appointment.patient?.lastName]
          .filter(Boolean)
          .join(' ') || 'Unknown patient',
      service: serviceNames(appointment.services).join(', ') || 'Unspecified',
      clinicId: appointment.clinic._id.toHexString(),
      clinicName: appointment.clinic.name,
    }));
  }
}
