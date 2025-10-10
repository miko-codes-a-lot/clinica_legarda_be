import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayDisconnect,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Notification } from './entities/notification.entity';
import { OnEvent } from '@nestjs/event-emitter';
import { AuthService } from 'src/auth/auth.service';
import * as cookie from 'cookie';

@WebSocketGateway({
  cors: {
    origin: '*',
    // origin: 'http://localhost:4200',
    // credentials: true,
  },
  namespace: 'notifications',
})
export class RtNotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RtNotificationsGateway.name);

  // A simple in-memory map to store userId and their corresponding socketId
  private connectedUsers: Map<string, string> = new Map();

  constructor(private readonly authService: AuthService) {}

  handleConnection(client: Socket) {
    try {
      const cookies = cookie.parse(client.handshake.headers.cookie || '');
      const token = cookies.jwt;
      if (!token) {
        throw new Error('Authentication token not found in cookie.');
      }

      const payload = this.authService.verifyJwt(token) as unknown as {
        sub: string;
      };
      const userId = payload.sub;
      this.connectedUsers.set(userId, client.id);

      this.logger.log(`Client connected: ${client.id}, UserID: ${userId}`);
    } catch (error) {
      this.logger.error('Authentication failed:', error);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (socketId === client.id) {
        this.connectedUsers.delete(userId);
        break;
      }
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @WebSocketServer()
  server: Server;

  @OnEvent('notification.created')
  handleNotificationCreated(notification: Notification) {
    this.sendNotificationToUser(
      notification.recipient._id.toString(),
      notification,
    );
  }

  @OnEvent('notifications.created')
  handleNotificationsCreated(notifications: Notification[]) {
    notifications.forEach((notification) => {
      this.sendNotificationToUser(
        notification.recipient._id.toString(),
        notification,
      );
    });
  }

  private sendNotificationToUser(userId: string, payload: Notification) {
    const socketId = this.connectedUsers.get(userId);

    if (socketId) {
      this.server.to(socketId).emit('new_notification', payload);
      this.logger.log(
        `Sent notification to user ${userId} on socket ${socketId}`,
      );
    }
  }
}
