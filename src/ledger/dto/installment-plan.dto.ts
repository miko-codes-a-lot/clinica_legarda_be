import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsInt, IsMongoId, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class InstallmentItemDto {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) amount: number;
}
export class InstallmentPlanDto {
  @IsMongoId() charge: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(120) @ValidateNested({ each: true }) @Type(() => InstallmentItemDto) items: InstallmentItemDto[];
}
export class ReviseInstallmentPlanDto {
  @IsInt() @Min(0) revision: number;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(120) @ValidateNested({ each: true }) @Type(() => InstallmentItemDto) items: InstallmentItemDto[];
}
