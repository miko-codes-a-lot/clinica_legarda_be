export class UserDto {
  sub: string;
  username: string;
  role: string;
  clinic?: string;
  otpPending?: boolean;
  iat: number;
  exp: number;
}
