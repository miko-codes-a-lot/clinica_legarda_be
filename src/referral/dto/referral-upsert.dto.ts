import { IsNotEmpty, IsOptional, IsMongoId, IsEnum, IsString, MaxLength } from 'class-validator';

import { ReferralStatus } from 'src/_shared/enum/referral-status.enum';

export class ReferralUpsertDto {
  @IsOptional()
  @IsMongoId()
  patient?: string;

  @IsNotEmpty()
  @IsMongoId()
  fromDoctorId: string;

  @IsNotEmpty()
  @IsMongoId()
  fromClinicId: string;

  @IsOptional()
  @IsString() @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString() @MaxLength(500)
  reasonOfDecline?: string;

  @IsOptional()
  appointment?: string;

  @IsOptional()
  @IsEnum(ReferralStatus)
  status?: ReferralStatus;
}
