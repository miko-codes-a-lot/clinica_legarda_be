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
import { UserActor } from '../auth/role-policy';
import { UserDto } from '../auth/dto/user.dto';
import { referenceId } from '../auth/record-policy';
import { NotificationsService } from './notifications.service';

@WebSocketGateway({
  namespace: 'notifications',
  path: '/api/socket.io',
})
export class RtNotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RtNotificationsGateway.name);

  private connectedUsers = new Map<
    string,
    { socketId: string; actor: UserActor }
  >();

  constructor(
    private readonly authService: AuthService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const cookies = cookie.parse(client.handshake.headers.cookie || '');
      const token = cookies.jwt;
      if (!token) {
        throw new Error('Authentication token not found in cookie.');
      }

      const payload: unknown = await this.authService.verifyJwt(token);
      if (!payload || typeof payload !== 'object')
        throw new Error('Invalid notification session.');
      const claims = payload as Partial<UserDto>;
      if (
        claims.otpPending ||
        typeof claims.sub !== 'string' ||
        typeof claims.role !== 'string'
      )
        throw new Error(
          'A fully authenticated notification session is required.',
        );
      // Each delivery resolves this authenticated identity's current persisted
      // role and clinic assignments, including promotions and demotions.
      const actor: UserActor = {
        sub: referenceId(claims.sub),
        role: claims.role,
      };
      await this.authService.resolveActor(actor);
      const userId = actor.sub;
      this.connectedUsers.set(userId, { socketId: client.id, actor });

      this.logger.log(`Client connected: ${client.id}, UserID: ${userId}`);
    } catch {
      this.logger.warn('Notification socket authentication failed.');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, connection] of this.connectedUsers.entries()) {
      if (connection.socketId === client.id) {
        this.connectedUsers.delete(userId);
        break;
      }
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @WebSocketServer()
  server: Server;

  @OnEvent('notification.created')
  async handleNotificationCreated(notification: Notification) {
    await this.sendNotificationToUser(
      referenceId(notification.recipient),
      notification,
    );
  }

  @OnEvent('notifications.created')
  async handleNotificationsCreated(notifications: Notification[]) {
    await Promise.all(
      notifications.map((notification) =>
        this.sendNotificationToUser(
          referenceId(notification.recipient),
          notification,
        ),
      ),
    );
  }

  private async sendNotificationToUser(userId: string, payload: Notification) {
    const connection = this.connectedUsers.get(userId);
    if (!connection) return;
    try {
      const actor = await this.authService.resolveActor(connection.actor);
      if (!(await this.notificationsService.canDeliverToActor(payload, actor)))
        return;
      if (this.connectedUsers.get(userId) !== connection) return;
      this.server.to(connection.socketId).emit('new_notification', payload);
      this.logger.log(`Sent notification on socket ${connection.socketId}`);
    } catch {
      this.logger.warn('Notification delivery authorization failed.');
    }
  }
}
