import { Controller, Post, Body, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { Response } from 'express';
import { Public } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('sign-in')
  async signIn(@Body() credentials: SignInDto, @Res() res: Response) {
    const { user, accessToken } = await this.authService.signIn(
      credentials.username,
      credentials.password,
    );

    res.cookie('jwt', accessToken, { httpOnly: true, sameSite: 'none' });

    return res.status(200).send({ user });
  }
}
