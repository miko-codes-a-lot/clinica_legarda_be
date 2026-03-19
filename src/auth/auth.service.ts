import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { OtpService } from 'src/otp/otp.service';
import { MailerService } from 'src/mailer/mailer.service';
import * as bcrypt from 'bcrypt';

const OTP_SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UsersService,
    private readonly otpService: OtpService,
    private readonly mailerService: MailerService,
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

    if (user.status && user.status === 'pending')
      throw new BadRequestException('Account is under verification');

    if (user.status && user.status === 'rejected')
      throw new BadRequestException('Account is rejected');

    user.password = undefined;

    // Check if OTP was verified within the last 24 hours
    const otpStillValid =
      user.otpVerifiedAt &&
      Date.now() - new Date(user.otpVerifiedAt).getTime() <
        OTP_SESSION_DURATION_MS;

    if (otpStillValid) {
      // Skip OTP — issue full access token directly
      const payload = {
        sub: user._id.toString(),
        username,
        role: user.role,
        ...(user.clinic && { clinic: user.clinic }),
      };
      const accessToken = await this.jwtService.signAsync(payload);

      return { user, accessToken, otpRequired: false };
    }

    // OTP required — send code and issue partial token
    if (!user.emailAddress) {
      throw new BadRequestException(
        'No email address on file. Cannot send OTP.',
      );
    }

    const otpCode = await this.otpService.generate(user._id.toString());
    await this.mailerService.sendOtp(user.emailAddress, otpCode);

    const partialPayload = {
      sub: user._id.toString(),
      otpPending: true,
    };
    const partialToken = await this.jwtService.signAsync(partialPayload, {
      expiresIn: '10m',
    });

    return { user, partialToken, otpRequired: true };
  }

  async resendOtp(userId: string) {
    const user = await this.userService.findOne(userId);
    if (!user) throw new BadRequestException('User not found');

    if (!user.emailAddress) {
      throw new BadRequestException(
        'No email address on file. Cannot send OTP.',
      );
    }

    const otpCode = await this.otpService.generate(userId);
    await this.mailerService.sendOtp(user.emailAddress, otpCode);
  }

  async verifyOtp(userId: string, code: string) {
    await this.otpService.verify(userId, code);

    const user = await this.userService.findOne(userId);
    if (!user) throw new BadRequestException('User not found');

    // Re-check user status in case it changed during OTP flow
    if (user.status === 'pending')
      throw new BadRequestException('Account is under verification');
    if (user.status === 'rejected')
      throw new BadRequestException('Account is rejected');

    await this.userService.updateOtpVerifiedAt(userId);
    await this.otpService.deleteForUser(userId);

    const payload = {
      sub: user._id.toString(),
      username: user.username,
      role: user.role,
      ...(user.clinic && { clinic: user.clinic }),
    };
    const accessToken = await this.jwtService.signAsync(payload);

    return { user, accessToken };
  }
}
