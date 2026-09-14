import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class AppointmentChangeReasonDto {
  // Older clients may omit this field; supplied reasons must be meaningful.
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(500)
  reason?: string;
}
