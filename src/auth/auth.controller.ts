import { Controller, Post, Body, Res, HttpStatus } from '@nestjs/common';
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

    res.cookie('jwt', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    });

    return res.status(200).send({ user });
  }

  @Post('sign-out')
  signOut(@Res() res: Response) {
    res.clearCookie('jwt', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    });

    return res.status(HttpStatus.NO_CONTENT).send();
  }
}
