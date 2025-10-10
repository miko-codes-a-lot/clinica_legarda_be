import { NotificationType } from '../entities/notification.entity';

export class CreateNotificationDto {
  recipient: string; // User ID
  message: string;
  type: NotificationType;
  link?: string;
  triggeredBy?: string; // User ID
}
