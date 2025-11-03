import { IsDate, IsNotEmpty, IsString, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class RescheduleAppointmentDto {
  @IsNotEmpty()
  @Type(() => Date)
  @IsDate()
  date: Date;

  @IsNotEmpty()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'startTime must be in HH:MM format (e.g., 09:00 or 14:30)',
  })
  startTime: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'endTime must be in HH:MM format (e.g., 09:00 or 14:30)',
  })
  endTime: string;

  @IsNotEmpty()
  @IsString()
  patient: string; // patient ID

  @IsNotEmpty()
  @IsString()
  dentist: string; // dentist ID
}
