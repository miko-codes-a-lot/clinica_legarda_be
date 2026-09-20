import { IsString, Matches, MaxLength } from 'class-validator';

export class RejectAppointmentDto {
  @IsString()
  @Matches(/\S/, { message: 'Enter a reason for rejecting the appointment.' })
  @MaxLength(500)
  reason: string;
}
