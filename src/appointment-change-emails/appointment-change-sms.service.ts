import { findPatientRecipient } from '../users/patient-recipient';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/entities/user.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { SmsService } from '../sms/sms.service';
import { AppointmentChangeEmail } from './entities/appointment-change-email.entity';
import { randomUUID } from 'crypto';
import { isSmsRecipient } from '../sms/sms-recipient';
import { Appointment } from '../appointments/entities/appointment.entity';
import { reservationDeadline } from '../appointments/appointment-time';
import { changeStillApplies, NEEDS_CURRENT_APPOINTMENT } from './appointment-change-validity';

/** Texts go out within this long of the change, so switching them on never announces old news. */
const MAX_EVENT_AGE = 24 * 60 * 60_000;

/** Texts the same queued appointment-change events that the email worker mails, tracking its own delivery state. */
@Injectable()
export class AppointmentChangeSmsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AppointmentChangeSmsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    @InjectModel(AppointmentChangeEmail.name) private readonly outbox: Model<AppointmentChangeEmail>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Clinic.name) private readonly clinics: Model<Clinic>,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get<boolean>('appointmentSms.enabled')) return;
    this.timer = setInterval(() => void this.tick(), 15_000);
    this.timer.unref();
    this.logger.log('Appointment change text notices enabled.');
    void this.tick();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.sendPending(); }
    catch { this.logger.error('Appointment change text scan failed; retrying on the next interval.'); }
    finally { this.running = false; }
  }

  async sendPending(): Promise<void> {
    const pending = { smsSentAt: { $exists: false }, smsSkippedAt: { $exists: false },
      createdAt: { $gte: new Date(Date.now() - MAX_EVENT_AGE) },
      $or: [{ smsLockedUntil: { $exists: false } }, { smsLockedUntil: { $lte: new Date() } }] };
    const events = await this.outbox.find(pending).sort({ createdAt: 1, _id: 1 }).limit(100).exec();
    for (const event of events) {
      const smsLeaseToken = randomUUID();
      const claimed = await this.outbox.findOneAndUpdate({ ...pending, _id: event._id },
        { $set: { smsLeaseToken, smsLockedUntil: new Date(Date.now() + 5 * 60_000) } }, { new: true }).exec();
      if (!claimed) continue;
      const claim = { _id: claimed._id, smsLeaseToken };
      const skip = () => this.outbox.updateOne(claim, { $set: { smsSkippedAt: new Date() }, $unset: { smsLeaseToken: 1, smsLockedUntil: 1 } }).exec();
      try {
        if (NEEDS_CURRENT_APPOINTMENT.includes(claimed.kind)) {
          const current = await this.appointments.findById(claimed.appointment).exec();
          if (!changeStillApplies(claimed, current)) { await skip(); continue; }
        }
        const [patient, clinic] = await Promise.all([
          findPatientRecipient(this.users, claimed.patient),
          this.clinics.findById(claimed.clinic).select('name address').exec(),
        ]);
        if (!clinic || !patient || !isSmsRecipient(patient.mobileNumber)) { await skip(); continue; }
        await this.sms.sendAppointmentChange(patient.mobileNumber, {
          kind: claimed.kind, patientName: patient.patientName, clinicName: clinic.name, clinicAddress: clinic.address || '',
          date: claimed.schedule.date, startTime: claimed.schedule.startTime, endTime: claimed.schedule.endTime,
          ...(claimed.kind === 'confirmed' ? { arrivalDeadline: reservationDeadline(new Date(claimed.schedule.date), claimed.schedule.startTime) } : {}),
          ...(claimed.previousSchedule ? { previousSchedule: {
            date: claimed.previousSchedule.date, startTime: claimed.previousSchedule.startTime, endTime: claimed.previousSchedule.endTime,
          } } : {}), reason: claimed.reason, changedAt: claimed.createdAt,
        });
        await this.outbox.updateOne(claim, { $set: { smsSentAt: new Date() }, $unset: { smsLeaseToken: 1, smsLockedUntil: 1 } }).exec();
      } catch {
        await this.outbox.updateOne(claim, { $set: { smsLockedUntil: new Date(Date.now() + 10 * 60_000) }, $unset: { smsLeaseToken: 1 } }).exec();
        this.logger.warn('Appointment change text delivery failed; it will be retried.');
      }
    }
  }
}
