import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Dentition } from './chart-rules';
export class DentalChartQueryDto {
  @IsMongoId() clinic: string;
  @IsIn(['permanent','primary']) dentition: Dentition;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) revision?: number;
}
export class ToothObservationDto {
  @IsInt() tooth: number;
  @IsString() @MaxLength(1000) observation: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class DentalChartSaveDto {
  @IsMongoId() clinic: string;
  @IsIn(['permanent','primary']) dentition: Dentition;
  @IsInt() @Min(0) expectedRevision: number;
  @IsArray() @ArrayMaxSize(32) @ValidateNested({ each: true }) @Type(() => ToothObservationDto) teeth: ToothObservationDto[];
}
