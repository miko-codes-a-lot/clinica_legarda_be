import { CLINIC_NAME } from '../_shared/clinic-brand';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { OtpService } from 'src/otp/otp.service';
import { MailerService } from 'src/mailer/mailer.service';
import { sendViaSemaphore } from './sms.helper';
import * as bcrypt from 'bcrypt';
import { assignedClinicIds } from '../users/clinic-membership';
import { UserActor } from './role-policy';
import { referenceId } from './record-policy';
import { UserStatus } from '../_shared/enum/user-status.enum';

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

  async resolveActor(actor: UserActor): Promise<UserActor> {
    const user = await this.userService.findForAuthentication(actor.sub);
    if (!user) throw new UnauthorizedException('Account is no longer available.');
    return {
      sub: referenceId(user._id),
      role: user.role,
      username: user.username,
      clinics: assignedClinicIds(user).map(referenceId),
    };
  }

  async signIn(username: string, password: string) {
    const user = await this.userService.findForSignIn(username);
    if (!user)
      throw new BadRequestException('Username or password is incorrect');

    const isCorrectPwd = await bcrypt.compare(password, user.password || '');

    if (!isCorrectPwd)
      throw new BadRequestException('Username or password is incorrect');

    user.password = undefined;
    this.requireActivePatient(user);

    // Check if OTP was verified within the last 24 hours
    const otpStillValid =
      (user.role !== 'user' || user.status === UserStatus.CONFIRMED) && user.otpVerifiedAt &&
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
        'Ask the clinic to add your email address before signing in for online booking.',
      );
    }

    const otpCode = await this.otpService.generate(user._id.toString(), user.emailAddress);
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
    const user = await this.userService.findForAuthentication(userId);
    if (!user) throw new BadRequestException('User not found');
    this.requireActivePatient(user);

    if (!user.emailAddress) {
      throw new BadRequestException(
        'No email address on file. Cannot send OTP.',
      );
    }

    const otpCode = await this.otpService.generate(userId, user.emailAddress);
    await this.mailerService.sendOtp(user.emailAddress, otpCode);
  }

  async verifyOtp(userId: string, code: string) {
    const current = await this.userService.findForAuthentication(userId);
    if (!current) throw new BadRequestException('User not found');
    this.requireActivePatient(current);
    await this.otpService.verify(userId, code, current.emailAddress);
    const user = await this.userService.completeEmailVerification(current);
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

  private requireActivePatient(user: { role: string; status: UserStatus }) {
    if (user.role === 'user' && user.status === UserStatus.REJECTED) {
      throw new BadRequestException('This patient account is rejected. Contact the clinic.');
    }
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
        `Your ${CLINIC_NAME} password reset code is ${otp}. Valid for 5 minutes.`,
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
