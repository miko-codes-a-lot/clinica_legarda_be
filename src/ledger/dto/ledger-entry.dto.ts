import { IsDateString, IsInt, IsMongoId, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class LedgerChargeDto {
  @IsMongoId() patient: string;
  @IsMongoId() clinic: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) amount: number;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @IsString() @MinLength(1) @MaxLength(500) description: string;
  @IsOptional() @IsMongoId() visit?: string;
  @IsOptional() @IsMongoId() careCase?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsUUID('4') operationId: string;
}
export class LedgerPaymentDto {
  @IsMongoId() charge: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) amount: number;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @IsString() @MinLength(1) @MaxLength(100) method: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsUUID('4') operationId: string;
}
export class LedgerClinicQueryDto { @IsOptional() @IsMongoId() clinic?: string; }
