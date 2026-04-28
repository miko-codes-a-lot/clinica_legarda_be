import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

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
  @MinLength(8)
  newPassword: string;
}
