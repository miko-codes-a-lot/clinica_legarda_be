import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { OtpService } from 'src/otp/otp.service';
import { MailerService } from 'src/mailer/mailer.service';
import { sendViaSemaphore } from './sms.helper';
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

  // 1. Generate reset OTP and send via SMS
  async generateResetOtp(emailAddress: string) {
    const user = await this.userService.findForResetOtp(emailAddress);

    // Silent success: don't reveal whether the email exists
    if (!user) return;

    if (!user.mobileNumber) return;

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 1000 * 60 * 5); // 5 minutes

    user.resetOtp = otp;
    user.resetOtpExpires = expiry;
    user.resetOtpVerified = false;
    await user.save();

    try {
      await sendViaSemaphore(
        user.mobileNumber,
        `Your Clinica Legarda password reset code is ${otp}. Valid for 5 minutes.`,
      );
    } catch (err) {
      console.error('Semaphore SMS failed:', err);
    }
  }

  // 2. Verify reset OTP
  async verifyResetOtp(emailAddress: string, otp: string) {
    const user = await this.userService.findForResetOtp(emailAddress);

    if (
      !user ||
      user.resetOtp !== otp ||
      !user.resetOtpExpires ||
      user.resetOtpExpires < new Date()
    ) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    user.resetOtpVerified = true;
    await user.save();
  }

  // 3. Reset password with verified OTP
  async resetPasswordWithOtp(emailAddress: string, newPassword: string) {
    const user = await this.userService.findForResetOtp(emailAddress);

    if (
      !user ||
      !user.resetOtpVerified ||
      !user.resetOtpExpires ||
      user.resetOtpExpires < new Date()
    ) {
      throw new BadRequestException('OTP not verified');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetOtp = undefined;
    user.resetOtpExpires = undefined;
    user.resetOtpVerified = false;
    await user.save();
  }
}
