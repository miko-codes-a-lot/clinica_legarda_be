import { IsDateString, IsMongoId, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
export class ClinicClosureDto {
  @IsMongoId() clinic: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate: string;
  @IsString() @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/) startTime = '00:00';
  @IsString() @Matches(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/) endTime = '24:00';
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
export class ClosureQueryDto { @IsOptional() @IsMongoId() clinic?: string; }
export class ClosureAvailabilityDto { @IsMongoId() clinic: string; }
export class ReopenClosureDto { @IsString() @MinLength(1) @MaxLength(500) reason: string; }
