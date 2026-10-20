import { patientRecipient, PatientNoticeRecipient, PatientRecipientSource, PATIENT_RECIPIENT_FIELDS, GUARDIAN_RECIPIENT_FIELDS } from '../users/patient-recipient';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { isEmailRecipient } from '../mailer/email-recipient';
import { Appointment } from '../appointments/entities/appointment.entity';
import { MailerService } from '../mailer/mailer.service';
import { AppointmentReminder } from './entities/appointment-reminder.entity';
import { AppointmentStatus } from '../_shared/enum/appointment-status.enum';
import { Clinic } from '../clinics/entities/clinic.entity';
import { User } from '../users/entities/user.entity';
import { appointmentStart, reservationDeadline } from '../appointments/appointment-time';

const DAY = 86_400_000;
const MANILA_OFFSET = 8 * 60 * 60 * 1000;
const RETRY_DELAY = 10 * 60 * 1000;
type Recipient = PatientRecipientSource;
type Location = Pick<Clinic, 'name' | 'address'> & { _id: Types.ObjectId };
export type PopulatedAppointment = Omit<Appointment, 'patient' | 'clinic'> & {
  _id: Types.ObjectId; patient: Recipient | null; clinic: Location | null;
};
/** Whether the notice recipient can be reached on a channel; email and text reminders differ only in this. */
export type Reachable = (recipient: PatientNoticeRecipient | null) => boolean;
const emailReachable: Reachable = recipient => isEmailRecipient(recipient?.emailAddress);

function startsAt(appointment: Pick<Appointment, 'date' | 'startTime'>): number {
  try { return appointmentStart(appointment.date, appointment.startTime).getTime(); }
  catch { return NaN; }
}

export function due(appointment: PopulatedAppointment, now: number, reachable: Reachable = emailReachable): boolean {
  const start = startsAt(appointment);
  return appointment.status === AppointmentStatus.CONFIRMED && !appointment.disruption &&
    start > now && start <= now + DAY && !!appointment.clinic &&
    reachable(patientRecipient(appointment.patient));
}

/** Confirmed, undisrupted appointments starting today or tomorrow (Manila), with their notice recipient and clinic. */
export async function findReminderCandidates(appointments: Model<Appointment>, now: number): Promise<PopulatedAppointment[]> {
  const localDay = new Date(now + MANILA_OFFSET).toISOString().slice(0, 10);
  const day = new Date(`${localDay}T00:00:00Z`);
  return appointments.find({
    status: AppointmentStatus.CONFIRMED,
    date: { $gte: day, $lt: new Date(day.getTime() + 2 * DAY) },
    disruption: { $exists: false },
  }).select('date startTime endTime status patient clinic disruption scheduleVersion')
    .populate<{ patient: Recipient | null }>({ path: 'patient', select: PATIENT_RECIPIENT_FIELDS, populate: { path: 'guardian', select: GUARDIAN_RECIPIENT_FIELDS } })
    .populate<{ clinic: Location | null }>('clinic', 'name address').exec();
}

/** One reminder per appointment schedule, patient and clinic: a changed schedule is reminded again. */
export function reminderKey(appointment: PopulatedAppointment): string {
  const schedule = [
    appointment._id, appointment.date.toISOString().slice(0, 10), appointment.startTime,
    appointment.endTime, appointment.patient?._id, appointment.clinic?._id,
  ];
  return createHash('sha256').update(JSON.stringify((appointment.scheduleVersion ?? 0) > 0 ? [...schedule, appointment.scheduleVersion] : schedule)).digest('hex');
}

/** The appointment as it is now, only if it still has the scanned schedule, patient and clinic and is still confirmed. */
export function findCurrentReminderAppointment(appointments: Model<Appointment>, appointment: PopulatedAppointment): Promise<PopulatedAppointment | null> {
  return appointments.findOne({
    _id: appointment._id, date: appointment.date, startTime: appointment.startTime,
    endTime: appointment.endTime, patient: appointment.patient?._id, clinic: appointment.clinic?._id,
    status: AppointmentStatus.CONFIRMED, disruption: { $exists: false },
    ...((appointment.scheduleVersion ?? 0) > 0 ? { scheduleVersion: appointment.scheduleVersion } :
      { $or: [{ scheduleVersion: { $exists: false } }, { scheduleVersion: 0 }] }),
  }).select('date startTime endTime status patient clinic disruption scheduleVersion')
    .populate<{ patient: Recipient | null }>({ path: 'patient', select: PATIENT_RECIPIENT_FIELDS, populate: { path: 'guardian', select: GUARDIAN_RECIPIENT_FIELDS } })
    .populate<{ clinic: Location | null }>('clinic', 'name address').exec();
}

@Injectable()
export class AppointmentRemindersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AppointmentRemindersService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
    @InjectModel(AppointmentReminder.name) private readonly reminders: Model<AppointmentReminder>,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get<boolean>('appointmentReminders.enabled')) return;
    // Local/test servers opt in explicitly; the production worker runs once per minute.
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
    this.logger.log('Appointment email reminders enabled.');
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.sendDueReminders(); }
    catch { this.logger.error('Appointment reminder scan failed; retrying on the next interval.'); }
    finally { this.running = false; }
  }

  async sendDueReminders(): Promise<void> {
    const candidates = await findReminderCandidates(this.appointments, Date.now());
    for (const appointment of candidates) {
      if (due(appointment, Date.now())) await this.deliver(appointment);
    }
  }

  private async deliver(appointment: PopulatedAppointment): Promise<void> {
    const key = reminderKey(appointment);
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
      // contacts) must not cause a reminder for the stale appointment snapshot.
      const current = await findCurrentReminderAppointment(this.appointments, appointment);
      if (!current || !due(current, Date.now()) || !current.patient || !current.clinic) {
        await this.reminders.deleteOne(claim).exec();
        return;
      }
      const recipient = patientRecipient(current.patient);
      if (!recipient?.emailAddress) { await this.reminders.deleteOne(claim).exec(); return; }
      await this.mailer.sendAppointmentReminder(recipient.emailAddress, {
        patientName: recipient.patientName,
        clinicName: current.clinic.name, clinicAddress: current.clinic.address || '',
        date: current.date.toISOString().slice(0, 10), startTime: current.startTime, endTime: current.endTime,
        arrivalDeadline: reservationDeadline(current.date, current.startTime),
      });
      await this.reminders.updateOne(claim, { $set: { sentAt: new Date() }, $unset: { lockedUntil: 1, leaseToken: 1 } }).exec();
    } catch {
      await this.reminders.updateOne(claim, { $set: { lockedUntil: new Date(Date.now() + RETRY_DELAY) }, $unset: { leaseToken: 1 } }).exec();
      this.logger.warn('Appointment reminder delivery failed; it will be retried.');
    }
  }
}
