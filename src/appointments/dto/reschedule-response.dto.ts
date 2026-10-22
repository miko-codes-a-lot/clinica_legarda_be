import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class RescheduleResponseDto {
  @IsUUID() proposalId: string;
  @IsIn(['patient_portal', 'phone', 'in_person', 'clinic_review']) method:
    | 'patient_portal'
    | 'phone'
    | 'in_person'
    | 'clinic_review';
  @IsOptional() @IsIn(['accept', 'decline']) decision?: 'accept' | 'decline';
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(500) reason?: string;
}
