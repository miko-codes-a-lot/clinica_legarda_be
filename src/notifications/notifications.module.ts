import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import {
  Notification,
  NotificationSchema,
} from './entities/notification.entity';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationListenerService } from './notification-listener.service';
import {
  Appointment,
  AppointmentSchema,
} from 'src/appointments/entities/appointment.entity';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: Appointment.name, schema: AppointmentSchema },
    ]),
    UsersModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationListenerService],
})
export class NotificationsModule {}
