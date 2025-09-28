import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UsersService,
  ) {}

  async signIn(username: string, password: string) {
    const a = await this.userService.findByOneUsername(username)
    console.log(a, 'a')

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
