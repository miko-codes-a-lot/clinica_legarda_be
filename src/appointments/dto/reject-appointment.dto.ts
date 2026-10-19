import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RejectAppointmentDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/\S/, { message: 'Enter a reason for rejecting the appointment.' })
  @MaxLength(500)
  @MinLength(3)
  reason: string;
}
