import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Appointment } from '../appointments/entities/appointment.entity';
import { UserActor } from '../auth/role-policy';
import { appointmentScope, referenceId, sameId } from '../auth/record-policy';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    private readonly eventEmitter: EventEmitter2,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
  ) {}

  async create(createNotificationDto: CreateNotificationDto) {
    const newNotification = new this.notificationModel(createNotificationDto);
    await newNotification.save();

    this.eventEmitter.emit('notification.created', newNotification);

    return newNotification;
  }

  async findAllForUser(actor: UserActor) {
    const notifications = await this.notificationModel
      .find({ recipient: referenceId(actor.sub) })
      .sort({ createdAt: -1 });
    if (actor.role === 'super-admin') return notifications;
    const appointmentIds = notifications
      .map((notification) => this.associatedAppointmentId(notification))
      .filter((id): id is string => !!id);
    const authorizedAppointments = appointmentIds.length
      ? await this.appointmentModel
          .find({
            _id: { $in: appointmentIds },
            ...appointmentScope(actor),
          })
          .select('_id')
          .lean()
      : [];
    const authorizedIds = new Set(
      authorizedAppointments.map((row) => row._id.toString()),
    );
    return notifications.filter((notification) => {
      const id = this.associatedAppointmentId(notification);
      return id
        ? authorizedIds.has(id)
        : this.permitsUnassociated(notification, actor);
    });
  }

  async markAsRead(
    notificationId: string,
    actor: UserActor,
  ): Promise<Notification | null> {
    const notification = await this.notificationModel.findOne({
      _id: referenceId(notificationId),
      recipient: referenceId(actor.sub),
    });
    if (!notification) return null;
    if (!(await this.canDeliverToActor(notification, actor)))
      throw new ForbiddenException('This notification is outside your access.');
    return this.notificationModel.findOneAndUpdate(
      { _id: notification._id, recipient: referenceId(actor.sub) },
      { read: true },
      { new: true },
    );
  }

  /** The caller must resolve current persisted actor privileges before delivery. */
  async canDeliverToActor(
    notification: Notification,
    actor: UserActor,
  ): Promise<boolean> {
    if (!sameId(notification.recipient, actor.sub)) return false;
    if (actor.role === 'super-admin') return true;
    const appointmentId = this.associatedAppointmentId(notification);
    if (!appointmentId) return this.permitsUnassociated(notification, actor);
    return !!(await this.appointmentModel.exists({
      _id: appointmentId,
      ...appointmentScope(actor),
    }));
  }

  private associatedAppointmentId(
    notification: Notification,
  ): string | undefined {
    if (notification.appointment != null) {
      try {
        return referenceId(notification.appointment);
      } catch {
        return undefined;
      }
    }
    return notification.link
      ?.match(/^\/admin\/appointment\/details\/([a-f\d]{24})\/?$/i)?.[1]
      .toLowerCase();
  }

  private permitsUnassociated(
    notification: Notification,
    actor: UserActor,
  ): boolean {
    return (
      (actor.role === 'user' || actor.role === 'dentist') &&
      !notification.appointment &&
      !notification.link?.startsWith('/admin/')
    );
  }

  async createMany(createNotificationDtos: CreateNotificationDto[]) {
    const createdNotifications = await this.notificationModel.insertMany(
      createNotificationDtos,
    );

    this.eventEmitter.emit('notifications.created', createdNotifications);

    return createdNotifications;
  }
}
