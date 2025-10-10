import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UsersService,
  ) {}

  verifyJwt(token: string) {
    return this.jwtService.verifyAsync(token, {
      secret: 'secret',
    });
  }

  async signIn(username: string, password: string) {
    const user = await this.userService.findByOneUsername(username);
    if (!user)
      throw new BadRequestException('Username or password is incorrect');

    const isCorrectPwd = await bcrypt.compare(password, user.password || '');

    if (!isCorrectPwd)
      throw new BadRequestException('Username or password is incorrect');

    user.password = undefined;

    const payload = {
      sub: user._id.toString(),
      username,
      role: user.role,
      ...(user.clinic && { clinic: user.clinic }),
    };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      user,
      accessToken,
    };
  }
}
