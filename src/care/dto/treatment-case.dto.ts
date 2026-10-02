import { IsIn, IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class TreatmentCaseDto {
  @IsMongoId() consultationVisit: string;
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsString() @MinLength(1) @MaxLength(4000) plan: string;
  @IsOptional() @IsString() @MaxLength(10000) internalNotes?: string;
}
export class TreatmentCaseStatusDto {
  @IsInt() @Min(0) revision: number;
  @IsIn(['completed', 'discontinued']) status: 'completed' | 'discontinued';
}
export class TreatmentCaseQueryDto {
  @IsOptional() @IsMongoId() patient?: string;
  @IsOptional() @IsMongoId() clinic?: string;
}
