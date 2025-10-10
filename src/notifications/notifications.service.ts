import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(createNotificationDto: CreateNotificationDto) {
    const newNotification = new this.notificationModel(createNotificationDto);
    await newNotification.save();

    this.eventEmitter.emit('notification.created', newNotification);

    return newNotification;
  }

  async findAllForUser(userId: string) {
    return this.notificationModel
      .find({ recipient: userId })
      .sort({ createdAt: -1 });
  }

  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<Notification | null> {
    return this.notificationModel.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { read: true },
      { new: true },
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
