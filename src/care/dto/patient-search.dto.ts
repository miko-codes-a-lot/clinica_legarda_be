import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class PatientSearchDto {
  @IsOptional() @IsIn(['pending', 'confirmed', 'walk_in', 'rejected']) status?: string;
  @IsOptional() @IsIn(['walk_in', 'standard']) registration?: 'walk_in' | 'standard';
  @IsOptional() @IsIn(['name', 'username', 'emailAddress', 'mobileNumber', 'status']) sortBy?: 'name' | 'username' | 'emailAddress' | 'mobileNumber' | 'status';
  @IsOptional() @IsIn(['asc', 'desc']) direction?: 'asc' | 'desc';
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsMongoId() clinic?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}

export class CareClinicQueryDto {
  @IsOptional() @IsMongoId() clinic?: string;
}
