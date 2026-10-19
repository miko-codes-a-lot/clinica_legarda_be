import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsInt, IsMongoId, IsOptional, Matches, Min, ValidateNested } from 'class-validator';
export class AvailabilityIntervalDto {
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/) startTime: string;
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/) endTime: string;
}
export class DentistDayAvailabilityDto {
  @IsMongoId() clinic: string;
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => AvailabilityIntervalDto) intervals: AvailabilityIntervalDto[];
  @IsInt() @Min(0) expectedRevision: number;
  @IsOptional() @IsBoolean() restoreWeeklyHours?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsMongoId({ each: true }) acknowledgedAppointmentIds?: string[];
}
export class DentistAvailabilityQueryDto {
  @IsMongoId() clinic: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
}
