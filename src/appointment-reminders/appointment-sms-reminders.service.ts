import { patientRecipient } from '../users/patient-recipient';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { isSmsRecipient } from '../sms/sms-recipient';
import { Appointment } from '../appointments/entities/appointment.entity';
import { SmsService } from '../sms/sms.service';
import { AppointmentReminder } from './entities/appointment-reminder.entity';
import { reservationDeadline } from '../appointments/appointment-time';
import {
  due, findCurrentReminderAppointment, findReminderCandidates, PopulatedAppointment, Reachable, reminderKey,
} from './appointment-reminders.service';

const RETRY_DELAY = 10 * 60 * 1000;
const smsReachable: Reachable = recipient => isSmsRecipient(recipient?.mobileNumber);

/** Texts the same reminders the email worker mails; its claims are kept apart (sms: prefix) so neither channel blocks the other. */
@Injectable()
export class AppointmentSmsRemindersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AppointmentSmsRemindersService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
    @InjectModel(AppointmentReminder.name) private readonly reminders: Model<AppointmentReminder>,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get<boolean>('appointmentSms.enabled')) return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
    this.logger.log('Appointment text reminders enabled.');
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.sendDueReminders(); }
    catch { this.logger.error('Appointment text reminder scan failed; retrying on the next interval.'); }
    finally { this.running = false; }
  }

  async sendDueReminders(): Promise<void> {
    const candidates = await findReminderCandidates(this.appointments, Date.now());
    for (const appointment of candidates) {
      if (due(appointment, Date.now(), smsReachable)) await this.deliver(appointment);
    }
  }

  private async deliver(appointment: PopulatedAppointment): Promise<void> {
    const key = `sms:${reminderKey(appointment)}`;
    const leaseToken = randomUUID();
    const now = new Date();
    try {
      // The deterministic _id is MongoDB's unique constraint. A duplicate means
      // another worker owns this schedule, or it has already been delivered.
      await this.reminders.findOneAndUpdate({
        _id: key, sentAt: { $exists: false },
        $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }],
      }, { $set: { appointment: appointment._id, leaseToken, lockedUntil: new Date(now.getTime() + 5 * 60_000) } },
      { upsert: true, new: true }).exec();
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) return;
      throw error;
    }
    const claim = { _id: key, leaseToken };
    try {
      // Changes after the scan (including rescheduling/cancellation or changed
      // contacts) must not cause a text for the stale appointment snapshot.
      const current = await findCurrentReminderAppointment(this.appointments, appointment);
      if (!current || !due(current, Date.now(), smsReachable) || !current.patient || !current.clinic) {
        await this.reminders.deleteOne(claim).exec();
        return;
      }
      const recipient = patientRecipient(current.patient);
      if (!recipient || !isSmsRecipient(recipient.mobileNumber)) { await this.reminders.deleteOne(claim).exec(); return; }
      await this.sms.sendAppointmentReminder(recipient.mobileNumber, {
        patientName: recipient.patientName,
        clinicName: current.clinic.name, clinicAddress: current.clinic.address || '',
        date: current.date.toISOString().slice(0, 10), startTime: current.startTime, endTime: current.endTime,
        arrivalDeadline: reservationDeadline(current.date, current.startTime),
      });
      await this.reminders.updateOne(claim, { $set: { sentAt: new Date() }, $unset: { lockedUntil: 1, leaseToken: 1 } }).exec();
    } catch {
      await this.reminders.updateOne(claim, { $set: { lockedUntil: new Date(Date.now() + RETRY_DELAY) }, $unset: { leaseToken: 1 } }).exec();
      this.logger.warn('Appointment text reminder delivery failed; it will be retried.');
    }
  }
}
