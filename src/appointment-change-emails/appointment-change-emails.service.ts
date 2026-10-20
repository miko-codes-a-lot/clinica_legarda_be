import { findPatientRecipient } from '../users/patient-recipient';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/entities/user.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { MailerService } from '../mailer/mailer.service';
import { AppointmentChangeEmail } from './entities/appointment-change-email.entity';
import { randomUUID } from 'crypto';
import { isEmailRecipient } from '../mailer/email-recipient';
import { Appointment } from '../appointments/entities/appointment.entity';
import { reservationDeadline } from '../appointments/appointment-time';
import { changeStillApplies, NEEDS_CURRENT_APPOINTMENT } from './appointment-change-validity';

@Injectable()
export class AppointmentChangeEmailsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AppointmentChangeEmailsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    @InjectModel(AppointmentChangeEmail.name) private readonly outbox: Model<AppointmentChangeEmail>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Clinic.name) private readonly clinics: Model<Clinic>,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get<boolean>('appointmentChangeEmails.enabled')) return;
    this.timer = setInterval(() => void this.tick(), 15_000);
    this.timer.unref();
    this.logger.log('Appointment change email notices enabled.');
    void this.tick();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.sendPending(); }
    catch { this.logger.error('Appointment change email scan failed; retrying on the next interval.'); }
    finally { this.running = false; }
  }

  async sendPending(): Promise<void> {
    const pending = { sentAt: { $exists: false }, skippedAt: { $exists: false },
      $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lte: new Date() } }] };
    const events = await this.outbox.find(pending).sort({ createdAt: 1, _id: 1 }).limit(100).exec();
    for (const event of events) {
      const leaseToken = randomUUID();
      const claimed = await this.outbox.findOneAndUpdate({ ...pending, _id: event._id },
        { $set: { leaseToken, lockedUntil: new Date(Date.now() + 5 * 60_000) } }, { new: true }).exec();
      if (!claimed) continue;
      const claim = { _id: claimed._id, leaseToken };
      try {
        if (NEEDS_CURRENT_APPOINTMENT.includes(claimed.kind)) {
          const current = await this.appointments.findById(claimed.appointment).exec();
          if (!changeStillApplies(claimed, current)) {
            await this.outbox.updateOne(claim, { $set: { skippedAt: new Date() }, $unset: { leaseToken: 1, lockedUntil: 1 } }).exec();
            continue;
          }
        }
        const [patient, clinic] = await Promise.all([
          findPatientRecipient(this.users, claimed.patient),
          this.clinics.findById(claimed.clinic).select('name address').exec(),
        ]);
        if (!clinic || !patient || !isEmailRecipient(patient.emailAddress)) {
          await this.outbox.updateOne(claim, { $set: { skippedAt: new Date() }, $unset: { leaseToken: 1, lockedUntil: 1 } }).exec();
          continue;
        }
        await this.mailer.sendAppointmentChange(patient.emailAddress, {
          kind: claimed.kind, patientName: patient.patientName, clinicName: clinic.name, clinicAddress: clinic.address || '',
          date: claimed.schedule.date, startTime: claimed.schedule.startTime, endTime: claimed.schedule.endTime,
          ...(claimed.kind === 'confirmed' ? { arrivalDeadline: reservationDeadline(new Date(claimed.schedule.date), claimed.schedule.startTime) } : {}),
          ...(claimed.previousSchedule ? { previousSchedule: {
            date: claimed.previousSchedule.date, startTime: claimed.previousSchedule.startTime, endTime: claimed.previousSchedule.endTime,
          } } : {}), reason: claimed.reason, changedAt: claimed.createdAt,
        });
        await this.outbox.updateOne(claim, { $set: { sentAt: new Date() }, $unset: { leaseToken: 1, lockedUntil: 1 } }).exec();
      } catch {
        await this.outbox.updateOne(claim, { $set: { lockedUntil: new Date(Date.now() + 10 * 60_000) }, $unset: { leaseToken: 1 } }).exec();
        this.logger.warn('Appointment change email delivery failed; it will be retried.');
      }
    }
  }
}
