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
  @IsIn(['patient_portal', 'phone', 'in_person']) method:
    | 'patient_portal'
    | 'phone'
    | 'in_person';
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(500) reason?: string;
}
