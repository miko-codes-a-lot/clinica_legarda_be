import {
  IsNotEmpty,
  IsOptional,
  IsMongoId,
  IsEnum,
} from 'class-validator';

import { ReferralStatus } from 'src/_shared/enum/referral-status.enum';


export class ReferralUpsertDto {
  @IsNotEmpty()
  @IsMongoId()
  fromDoctorId: string;

  @IsNotEmpty()
  @IsMongoId()
  fromClinicId: string;

  @IsOptional()
  reason: string;

  @IsOptional()
  reasonOfDecline: string;

  @IsOptional()
  appointment: String;

  @IsOptional()
  @IsEnum(ReferralStatus)
  status?: ReferralStatus;

}
