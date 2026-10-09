import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { isEmail } from 'class-validator';
import { Appointment } from '../appointments/entities/appointment.entity';
import { MailerService } from '../mailer/mailer.service';
import { AppointmentReminder } from './entities/appointment-reminder.entity';
import { AppointmentStatus } from '../_shared/enum/appointment-status.enum';
import { Clinic } from '../clinics/entities/clinic.entity';
import { User } from '../users/entities/user.entity';

const DAY = 86_400_000;
const MANILA_OFFSET = 8 * 60 * 60 * 1000;
const RETRY_DELAY = 10 * 60 * 1000;
type Recipient = Pick<User, 'emailAddress'> & { _id: Types.ObjectId };
type Location = Pick<Clinic, 'name' | 'address'> & { _id: Types.ObjectId };
type PopulatedAppointment = Omit<Appointment, 'patient' | 'clinic'> & {
  _id: Types.ObjectId; patient: Recipient | null; clinic: Location | null;
};

function startsAt(appointment: Pick<Appointment, 'date' | 'startTime'>): number {
  if (!appointment.date || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(appointment.startTime)) return NaN;
  const [hours, minutes] = appointment.startTime.split(':').map(Number);
  return Date.UTC(appointment.date.getUTCFullYear(), appointment.date.getUTCMonth(), appointment.date.getUTCDate(), hours, minutes) - MANILA_OFFSET;
}

function due(appointment: PopulatedAppointment, now: number): boolean {
  const start = startsAt(appointment);
  return appointment.status === AppointmentStatus.CONFIRMED && !appointment.disruption &&
    start > now && start <= now + DAY && !!appointment.clinic &&
    typeof appointment.patient?.emailAddress === 'string' && isEmail(appointment.patient.emailAddress);
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
    const now = Date.now();
    const localDay = new Date(now + MANILA_OFFSET).toISOString().slice(0, 10);
    const day = new Date(`${localDay}T00:00:00Z`);
    const candidates = await this.appointments.find({
      status: AppointmentStatus.CONFIRMED,
      date: { $gte: day, $lt: new Date(day.getTime() + 2 * DAY) },
      disruption: { $exists: false },
    }).select('date startTime endTime status patient clinic disruption')
      .populate<{ patient: Recipient | null }>('patient', 'emailAddress')
      .populate<{ clinic: Location | null }>('clinic', 'name address').exec();
    for (const appointment of candidates) {
      if (due(appointment, Date.now())) await this.deliver(appointment);
    }
  }

  private async deliver(appointment: PopulatedAppointment): Promise<void> {
    const key = createHash('sha256').update(JSON.stringify([
      appointment._id, appointment.date.toISOString().slice(0, 10), appointment.startTime,
      appointment.endTime, appointment.patient?._id, appointment.clinic?._id,
    ])).digest('hex');
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
      const current = await this.appointments.findOne({
        _id: appointment._id, date: appointment.date, startTime: appointment.startTime,
        endTime: appointment.endTime, patient: appointment.patient?._id, clinic: appointment.clinic?._id,
        status: AppointmentStatus.CONFIRMED, disruption: { $exists: false },
      }).select('date startTime endTime status patient clinic disruption')
        .populate<{ patient: Recipient | null }>('patient', 'emailAddress')
        .populate<{ clinic: Location | null }>('clinic', 'name address').exec();
      if (!current || !due(current, Date.now()) || !current.patient || !current.clinic) {
        await this.reminders.deleteOne(claim).exec();
        return;
      }
      await this.mailer.sendAppointmentReminder(current.patient.emailAddress, {
        clinicName: current.clinic.name, clinicAddress: current.clinic.address || '',
        date: current.date.toISOString().slice(0, 10), startTime: current.startTime, endTime: current.endTime,
      });
      await this.reminders.updateOne(claim, { $set: { sentAt: new Date() }, $unset: { lockedUntil: 1, leaseToken: 1 } }).exec();
    } catch {
      await this.reminders.updateOne(claim, { $set: { lockedUntil: new Date(Date.now() + RETRY_DELAY) }, $unset: { leaseToken: 1 } }).exec();
      this.logger.warn('Appointment reminder delivery failed; it will be retried.');
    }
  }
}
