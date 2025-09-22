import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async signIn(username: string, password: string) {
    const payload = { sub: 'userId', username };
    const accessToken = await this.jwtService.signAsync(payload);

    const user = {
      username,
    };
    return {
      user,
      accessToken,
    };
  }
}
