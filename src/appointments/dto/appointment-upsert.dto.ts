import {
  IsArray,
  IsDate,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AppointmentStatus } from 'src/_shared/enum/appointment-status.enum';

class AppointmentNoteDto {
  @IsOptional()
  @IsString()
  patientNotes?: string;

  @IsOptional()
  @IsString()
  clinicNotes?: string;
}

export class AppointmentUpsertDto {
  @IsNotEmpty()
  @IsMongoId()
  clinic: string;

  @IsNotEmpty()
  @IsMongoId()
  patient: string;

  @IsNotEmpty()
  @IsMongoId()
  dentist: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  services?: string[];

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

  // Status is optional because the schema provides a default ('PENDING')
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @ValidateNested()
  @Type(() => AppointmentNoteDto)
  notes?: AppointmentNoteDto;
}
