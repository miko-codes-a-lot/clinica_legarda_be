import { Controller, Get, Param, Patch } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { User } from 'src/_shared/decorators/user.decorator';
import { UserDto } from 'src/auth/dto/user.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@User() user: UserDto) {
    return this.notificationsService.findAllForUser(user.sub);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @User() user: UserDto) {
    return this.notificationsService.markAsRead(id, user.sub);
  }
}
