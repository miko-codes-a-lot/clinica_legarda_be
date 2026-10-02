import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class PatientSearchDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsMongoId() clinic?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}

export class CareClinicQueryDto {
  @IsOptional() @IsMongoId() clinic?: string;
}
