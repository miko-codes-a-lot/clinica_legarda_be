import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request: Request = context.switchToHttp().getRequest();
    const cookies = request.cookies as unknown as Record<string, any>;

    const token: string | null = cookies?.jwt ? (cookies.jwt as string) : null;

    if (!token) throw new UnauthorizedException('Auth token not found');

    try {
      const payload: unknown = await this.jwtService.verifyAsync(token, {
        secret: 'secret',
      });
      request['user'] = payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }

    return true;
  }
}
