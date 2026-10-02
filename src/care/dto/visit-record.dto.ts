import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class VisitTreatmentDto {
  @IsString() @MinLength(1) @MaxLength(500) description: string;
  @IsOptional() @IsString() @MaxLength(100) tooth?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}
export class VisitRecordDto {
  @IsInt() @Min(0) revision: number;
  @IsBoolean() complete: boolean;
  @IsString() @MaxLength(10000) assessment: string;
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => VisitTreatmentDto) treatments: VisitTreatmentDto[];
  @IsString() @MaxLength(4000) summary: string;
  @IsString() @MaxLength(4000) aftercare: string;
  @IsString() @MaxLength(4000) nextSteps: string;
}
