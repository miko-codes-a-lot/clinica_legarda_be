import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { UserActor } from '../auth/role-policy';
import { UsersService } from './users.service';

/** Guards run before Multer writes a submitted file to disk. */
@Injectable()
export class ProfilePictureGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ params: { id: string }; user: UserActor }>();
    await this.users.authorizePictureWrite(request.params.id, request.user);
    return true;
  }
}
