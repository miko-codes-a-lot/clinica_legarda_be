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
import { RtNotificationsGateway } from './rt-notifications.gateway';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: Appointment.name, schema: AppointmentSchema },
    ]),
    UsersModule,
    AuthModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationListenerService,
    RtNotificationsGateway,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
