import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Appointment,
  AppointmentDocument,
} from 'src/appointments/entities/appointment.entity';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './entities/notification.entity';
import { AppointmentStatus } from 'src/_shared/enum/appointment-status.enum';
import { UsersService } from 'src/users/users.service';
import { CreateNotificationDto } from './dto/create-notification.dto';

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
              case 'update':
                if (change.updateDescription.updatedFields?.status) {
                  const updatedAppointment = await this.appointmentModel
                    .findById(change.documentKey._id)
                    .populate('patient dentist');

                  if (updatedAppointment) {
                    await this.handleAppointmentStatusUpdate(
                      updatedAppointment,
                    );
                  }
                }
                break;
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

  private async handleAppointmentCreation(appointment: AppointmentDocument) {
    this.logger.log(`New appointment created: ${appointment._id.toString()}`);

    const populatedAppointment = await this.appointmentModel
      .findById(appointment._id)
      .populate('patient dentist');

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

    // 1. Add patient notification to the list
    notificationsToCreate.push({
      recipient: appointment.patient._id.toString(),
      message: `Your appointment with Dr. ${dentistName} has been booked and is pending confirmation.`,
      type: NotificationType.APPOINTMENT_CREATED,
      link: `/app/my-appointment/details/${appointment._id.toString()}`,
    });

    // 2. Add dentist notification to the list
    notificationsToCreate.push({
      recipient: appointment.dentist._id.toString(),
      message: `You have a new appointment request from ${patientName}.`,
      type: NotificationType.APPOINTMENT_CREATED,
      link: `/admin/appointment/details/${appointment._id.toString()}`,
    });

    // 3. Add admin notifications to the list
    const admins = await this.userService.findAll('admin');
    const adminMessage = `New appointment created for Dr. ${dentistName} by patient ${patientName}.`;
    admins.forEach((admin) => {
      notificationsToCreate.push({
        recipient: admin._id.toString(),
        message: adminMessage,
        type: NotificationType.APPOINTMENT_CREATED,
        link: `/admin/appointment/details/${appointment._id.toString()}`,
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
  ) {
    this.logger.log(
      `Appointment ${appointment._id.toString()} status updated to: ${appointment.status}`,
    );
    const patientName = `${appointment.patient.firstName} ${appointment.patient.lastName}`;
    const dentistName = `${appointment.dentist.firstName} ${appointment.dentist.lastName}`;

    let patientMessage: string | null = null;
    let dentistMessage: string | null = null;

    switch (appointment.status) {
      case AppointmentStatus.CONFIRMED:
        patientMessage = `Your appointment with Dr. ${dentistName} has been confirmed.`;
        dentistMessage = `You have confirmed the appointment for ${patientName}.`;
        break;
      case AppointmentStatus.CANCELLED:
        patientMessage = `Your appointment with Dr. ${dentistName} has been cancelled.`;
        dentistMessage = `The appointment for ${patientName} has been cancelled.`;
        break;
      case AppointmentStatus.COMPLETED:
        patientMessage = `Your appointment with Dr. ${dentistName} is complete. Thank you!`;
        break;
    }

    if (patientMessage) {
      await this.notificationService.create({
        recipient: appointment.patient._id.toString(),
        message: patientMessage,
        type: NotificationType.APPOINTMENT_STATUS_UPDATED,
        link: `/app/my-appointment/details/${appointment._id.toString()}`,
      });
    }

    if (dentistMessage) {
      await this.notificationService.create({
        recipient: appointment.dentist._id.toString(),
        message: dentistMessage,
        type: NotificationType.APPOINTMENT_STATUS_UPDATED,
        link: `/admin/appointment/details/${appointment._id.toString()}`,
      });
    }
  }
}
