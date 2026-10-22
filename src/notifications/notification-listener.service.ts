import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Appointment,
  AppointmentDocument,
  AppointmentHistory,
} from 'src/appointments/entities/appointment.entity';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './entities/notification.entity';
import { AppointmentStatus } from 'src/_shared/enum/appointment-status.enum';
import { UsersService } from 'src/users/users.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { reservationDeadline } from '../appointments/appointment-time';

@Injectable()
export class NotificationListenerService implements OnModuleInit {
  private readonly logger = new Logger(NotificationListenerService.name);
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    private readonly notificationService: NotificationsService,
    private readonly userService: UsersService,
  ) {}

  onModuleInit() {
    this.watchAppointmentChanges();
  }

  private watchAppointmentChanges() {
    this.appointmentModel.collection
      .watch<AppointmentDocument>()
      .on('change', (change) => {
        const handle = async () => {
          try {
            switch (change.operationType) {
              case 'insert':
                await this.handleAppointmentCreation(change.fullDocument);
                break;
              case 'update': {
                const fields = change.updateDescription.updatedFields ?? {};
                const rescheduled = ['date', 'startTime', 'endTime'].some(
                  field => Object.prototype.hasOwnProperty.call(fields, field),
                );
                const proposalChanged = Object.keys(fields).some(key => key === 'rescheduleProposal' || key.startsWith('rescheduleProposal.')) ||
                  change.updateDescription.removedFields?.includes('rescheduleProposal');
                if (fields?.status || rescheduled || proposalChanged) {
                  const updatedAppointment = await this.appointmentModel
                    .findById(change.documentKey._id)
                    .populate('patient dentist');

                  if (updatedAppointment && this.matchesHistoryEvent(fields, updatedAppointment) && (!fields.status || fields.status === updatedAppointment.status) &&
                    (fields.scheduleVersion === undefined || fields.scheduleVersion === (updatedAppointment.scheduleVersion ?? 0)) &&
                    (!fields.rescheduleProposal || (fields.rescheduleProposal as { id?: string }).id === updatedAppointment.rescheduleProposal?.id)) {
                    await this.handleAppointmentStatusUpdate(
                      updatedAppointment,
                      rescheduled || (!!proposalChanged && updatedAppointment.status === AppointmentStatus.PENDING),
                      updatedAppointment.history?.[this.historyEventIndex(fields) ?? (updatedAppointment.history.length - 1)],
                    );
                  }
                }
                break;
              }
            }
          } catch (error) {
            this.logger.error('Error processing stream event:', error);
          }
        };

        handle()
          .then(() => this.logger.log('appointment listen completed'))
          .catch((e) => this.logger.error(e));
      });
  }

  /** Mongo emits a pushed history entry either as the full array or history.N. */
  private historyEventIndex(fields: Record<string, unknown>): number | undefined {
    if (Array.isArray(fields.history)) return fields.history.length - 1;
    const indexes = Object.keys(fields).flatMap(key => {
      const match = /^history\.(\d+)$/.exec(key);
      return match ? [Number(match[1])] : [];
    });
    return indexes.length ? Math.max(...indexes) : undefined;
  }

  private matchesHistoryEvent(fields: Record<string, unknown>, appointment: AppointmentDocument): boolean {
    const index = this.historyEventIndex(fields);
    if (index === undefined) return true;
    const history = appointment.history ?? [];
    // Notes do not supersede a decision. Use the decision's own actor below.
    // A later proposal/response/status transition does supersede it.
    return index >= 0 && index < history.length && history.slice(index + 1).every(entry =>
      ['Clinical notes updated.', 'Appointment details updated.'].includes(entry.action));
  }

  private async handleAppointmentCreation(appointment: AppointmentDocument) {
    this.logger.log(`New appointment created: ${appointment._id.toString()}`);

    const populatedAppointment = await this.appointmentModel
      .findById(appointment._id)
      .populate('patient dentist');

    if (populatedAppointment && ((populatedAppointment.scheduleVersion ?? 0) !== (appointment.scheduleVersion ?? 0) || populatedAppointment.status !== appointment.status)) return;
    if (!populatedAppointment) {
      this.logger.error(
        `Newly created appointment not found: ${appointment._id.toString()}`,
      );
      return;
    }

    const patientName = `${populatedAppointment.patient.firstName} ${populatedAppointment.patient.lastName}`;
    const dentistName = `${populatedAppointment.dentist.firstName} ${populatedAppointment.dentist.lastName}`;

    // Prepare an array of all notifications to be created
    const notificationsToCreate: CreateNotificationDto[] = [];

    const recipient = await this.userService.notificationPatientRecipient(populatedAppointment.patient._id);
    // Child notices go only to the current verified parent.
    if (recipient) notificationsToCreate.push({
      recipient: recipient.id,
      message: `${recipient.patientName ? recipient.patientName + ": " : ""}Your appointment with Dr. ${dentistName} has been booked and is pending confirmation.`,
      type: NotificationType.APPOINTMENT_CREATED,
      link: '/app/my-appointment',
      appointment: appointment._id.toString(),
    });

    // 2. Add dentist notification to the list
    notificationsToCreate.push({
      recipient: appointment.dentist._id.toString(),
      message: `You have a new appointment request from ${patientName}.`,
      type: NotificationType.APPOINTMENT_CREATED,
      link: `/dentist/appointment/details/${appointment._id.toString()}`,
      appointment: appointment._id.toString(),
    });

    // 3. Add admin notifications to the list
    const admins = await this.userService.notificationStaffRecipients(
      populatedAppointment.clinic.toString(),
    );
    const adminMessage = `New appointment created for Dr. ${dentistName} by patient ${patientName}.`;
    admins.forEach((admin) => {
      notificationsToCreate.push({
        recipient: admin._id.toString(),
        message: adminMessage,
        type: NotificationType.APPOINTMENT_CREATED,
        link: `/admin/appointment/details/${appointment._id.toString()}`,
        appointment: appointment._id.toString(),
      });
    });

    if (notificationsToCreate.length > 0) {
      await this.notificationService.createMany(notificationsToCreate);
      this.logger.log(
        `Successfully created ${notificationsToCreate.length} notifications in bulk.`,
      );
    }
  }

  private async handleAppointmentStatusUpdate(
    appointment: AppointmentDocument,
    rescheduled = false,
    transition?: AppointmentHistory,
  ) {
    this.logger.log(
      `Appointment ${appointment._id.toString()} status updated to: ${appointment.status}`,
    );
    const patientName = `${appointment.patient.firstName} ${appointment.patient.lastName}`;
    const dentistName = `${appointment.dentist.firstName} ${appointment.dentist.lastName}`;

    const notificationsToCreate: CreateNotificationDto[] = [];

    let patientMessage: string | null = null;
    let dentistMessage: string | null = null;

    // Not important to notify the admin that the appointment status has changed
    // the admin is only interested in the creation
    // let adminMessage: string | null = null;

    const latest = transition ?? appointment.history?.[appointment.history.length - 1];
    if (latest?.action === 'Clinic closure requires manual review of ongoing care.') return;
    const patientRequested = rescheduled && (!appointment.rescheduleProposal || appointment.rescheduleProposal.proposedBySide === 'patient') && appointment.status === AppointmentStatus.PENDING && latest?.actorRole === 'user';
    if (patientRequested) {
      patientMessage = 'Your requested appointment time is awaiting clinic review.';
      dentistMessage = `${patientName} requested another appointment time. Please review the request.`;
    } else if (appointment.rescheduleProposal && appointment.status === AppointmentStatus.PENDING) {
      patientMessage = 'The clinic proposed a new appointment time. Sign in to accept, request another time, or cancel before the proposed start. An unanswered proposal will automatically cancel.';
      dentistMessage = `The proposed schedule for ${patientName} is awaiting the patient response.`;
    } else if (rescheduled) {
      const date = new Date(appointment.date).toISOString().slice(0, 10);
      const schedule = `${date}, ${appointment.startTime}–${appointment.endTime}`;
      patientMessage = `Your appointment with Dr. ${dentistName} has been rescheduled to ${schedule} and is ${appointment.status}.`;
      dentistMessage = `The appointment for ${patientName} has been rescheduled to ${schedule} and is ${appointment.status}.`;
    } else switch (appointment.status) {
      case AppointmentStatus.NEEDS_RESCHEDULING:
        // Initial closure notices are already committed in the closure transaction.
        if (latest?.action === 'Replacement schedule declined; appointment needs rescheduling.') {
          const deadline = appointment.closureRescheduling?.expiresAt;
          const until = deadline ? ` by ${new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(deadline)} (Philippine time)` : '';
          patientMessage = `The proposed replacement was declined. Choose another schedule${until}, otherwise the appointment will automatically cancel.`;
          dentistMessage = `${patientName}'s proposed replacement was declined. Arrange another schedule${until}.`;
        }
        break;
      case AppointmentStatus.PENDING:
        patientMessage = `Your appointment with Dr. ${dentistName} is pending confirmation.`;
        dentistMessage = `The appointment for ${patientName} is pending confirmation.`;
        break;
      case AppointmentStatus.REJECTED:
        patientMessage = `Your appointment with Dr. ${dentistName} has been rejected.`;
        dentistMessage = `The appointment for ${patientName} has been rejected.`;
        break;
      case AppointmentStatus.CONFIRMED:
        patientMessage = `Your appointment with Dr. ${dentistName} has been confirmed. Check in by ${new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(reservationDeadline(appointment.date, appointment.startTime))} (Philippine time), 20 minutes after the start, to avoid No-show.`;
        dentistMessage = `The appointment for ${patientName} has been confirmed.`;
        // adminMessage = `Dr. ${dentistName} confirmed the appointment for ${patientName}.`;
        break;
      case AppointmentStatus.CANCELLED:
        patientMessage = `Your appointment with Dr. ${dentistName} has been cancelled.${latest?.reason ? ' Reason: ' + latest.reason : ''}`;
        dentistMessage = `The appointment for ${patientName} has been cancelled.${latest?.reason ? ' Reason: ' + latest.reason : ''}`;
        // adminMessage = `The appointment for ${patientName} with Dr. ${dentistName} has been cancelled.${latest?.reason ? ' Reason: ' + latest.reason : ''}`;
        break;
      case AppointmentStatus.COMPLETED:
        patientMessage = `Your appointment with Dr. ${dentistName} is complete. Thank you!`;
        dentistMessage = `The appointment for ${patientName} is complete.`;
        break;
      case AppointmentStatus.NO_SHOW:
        patientMessage = `Your appointment with Dr. ${dentistName} has been marked as no show.`;
        dentistMessage = `The appointment for ${patientName} has been marked as no show.`;
        break;
    }

    const recipient = await this.userService.notificationPatientRecipient(appointment.patient._id);
    if (patientMessage && recipient) {
      notificationsToCreate.push({
        recipient: recipient.id,
        message: `${recipient.patientName ? recipient.patientName + ": " : ""}${patientMessage}`,
        type: NotificationType.APPOINTMENT_STATUS_UPDATED,
        link: '/app/my-appointment',
        appointment: appointment._id.toString(),
      });
    }

    if (dentistMessage && latest?.actorId !== appointment.dentist._id.toString()) {
      notificationsToCreate.push({
        recipient: appointment.dentist._id.toString(),
        message: dentistMessage,
        type: NotificationType.APPOINTMENT_STATUS_UPDATED,
        link: `/dentist/appointment/details/${appointment._id.toString()}`,
        appointment: appointment._id.toString(),
      });
    }

    if (patientRequested) {
      const admins = await this.userService.notificationStaffRecipients(appointment.clinic.toString());
      for (const admin of admins) notificationsToCreate.push({ recipient: admin._id.toString(), message: dentistMessage ?? 'Patient requested another time. Please review.',
        type: NotificationType.APPOINTMENT_STATUS_UPDATED, appointment: appointment._id.toString(),
        link: `/${admin.role === 'super-admin' ? 'super-admin' : 'admin'}/appointment/details/${appointment._id.toString()}` });
    }

    if (notificationsToCreate.length > 0) {
      await this.notificationService.createMany(notificationsToCreate);
      this.logger.log(
        `Successfully created ${notificationsToCreate.length} notifications for status update.`,
      );
    }
  }
}
