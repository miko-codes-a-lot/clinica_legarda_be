import { IsEmail, IsBoolean, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
export class DependentUpsertDto {
  @IsString() @IsNotEmpty() @MaxLength(100) firstName: string;
  @IsOptional() @IsString() @MaxLength(100) middleName?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) lastName: string;
  @IsString() @IsNotEmpty() @MaxLength(10) birthDate: string;
  @IsOptional() @IsString() @MaxLength(100) sex?: string;
}
export class LinkGuardianDto {
  @IsMongoId() guardian: string;
  @IsBoolean() confirmExistingPatient: boolean;
}

export class GuardianCandidateDto { @IsEmail() @MaxLength(254) emailAddress: string; }
