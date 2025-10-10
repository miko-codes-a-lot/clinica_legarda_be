import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
  ) {}

  create(createNotificationDto: CreateNotificationDto) {
    const newNotification = new this.notificationModel(createNotificationDto);
    return newNotification.save();
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

  createMany(createNotificationDtos: CreateNotificationDto[]) {
    return this.notificationModel.insertMany(createNotificationDtos);
  }
}
