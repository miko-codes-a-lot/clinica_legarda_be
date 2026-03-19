import { Controller, Post, Body, Res, Req, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { Request, Response } from 'express';
import { Public } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('sign-in')
  async signIn(@Body() credentials: SignInDto, @Res() res: Response) {
    const result = await this.authService.signIn(
      credentials.username,
      credentials.password,
    );

    if (result.otpRequired) {
      res.cookie('jwt', result.partialToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
      });

      return res.status(200).send({ user: result.user, otpRequired: true });
    }

    res.cookie('jwt', result.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    });

    return res.status(200).send({ user: result.user });
  }

  @Public()
  @Post('verify-otp')
  async verifyOtp(
    @Body() body: VerifyOtpDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookies = req.cookies as Record<string, any>;
    const token: string | null = cookies?.jwt ? (cookies.jwt as string) : null;

    if (!token) {
      return res.status(401).send({ message: 'Session expired. Please sign in again.' });
    }

    let payload: any;
    try {
      payload = await this.authService.verifyJwt(token);
    } catch {
      return res.status(401).send({ message: 'Session expired. Please sign in again.' });
    }

    if (!payload.otpPending) {
      return res.status(400).send({ message: 'OTP verification not required.' });
    }

    const { user, accessToken } = await this.authService.verifyOtp(
      payload.sub,
      body.code,
    );

    res.cookie('jwt', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    });

    return res.status(200).send({ user });
  }

  @Public()
  @Post('resend-otp')
  async resendOtp(@Req() req: Request, @Res() res: Response) {
    const cookies = req.cookies as Record<string, any>;
    const token: string | null = cookies?.jwt ? (cookies.jwt as string) : null;

    if (!token) {
      return res.status(401).send({ message: 'Session expired. Please sign in again.' });
    }

    let payload: any;
    try {
      payload = await this.authService.verifyJwt(token);
    } catch {
      return res.status(401).send({ message: 'Session expired. Please sign in again.' });
    }

    if (!payload.otpPending) {
      return res.status(400).send({ message: 'OTP verification not required.' });
    }

    await this.authService.resendOtp(payload.sub);

    return res.status(200).send({ message: 'OTP resent successfully' });
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
