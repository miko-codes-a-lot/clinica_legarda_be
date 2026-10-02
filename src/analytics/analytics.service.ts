import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppointmentStatus } from 'src/_shared/enum/appointment-status.enum';
import { ReferralStatus } from 'src/_shared/enum/referral-status.enum';
import { Appointment } from 'src/appointments/entities/appointment.entity';
import { Referral } from 'src/referral/entities/referral.entity';
import { appointmentScope, referenceId } from '../auth/record-policy';
import { isAdmin, UserActor } from '../auth/role-policy';
import { assertClinicAccess } from '../auth/clinic-policy';
import { reportPeriod } from './report-period';
import {
  DailyQueueResponse,
  WeeklySummaryResponse,
  WeeklyTrendResponse,
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
  ) {}

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
