import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsStrongPassword,
  Matches,
} from 'class-validator';
import {
  PASSWORD_REQUIREMENTS,
  PASSWORD_REQUIREMENTS_MESSAGE,
} from 'src/_shared/validation/password-policy';

export class ForgotPasswordOtpDto {
  @IsEmail()
  @IsNotEmpty()
  emailAddress: string;
}

export class VerifyResetOtpDto {
  @IsEmail()
  @IsNotEmpty()
  emailAddress: string;

  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'OTP must be a 6-digit numeric code' })
  otp: string;
}

export class ResetPasswordOtpDto {
  @IsEmail()
  @IsNotEmpty()
  emailAddress: string;

  @IsString()
  @IsStrongPassword(PASSWORD_REQUIREMENTS, {
    message: PASSWORD_REQUIREMENTS_MESSAGE,
  })
  newPassword: string;
}
