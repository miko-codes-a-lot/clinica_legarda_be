import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';
import { ReportPeriodKind } from '../report-period';
export class ReportQueryDto {
  @IsOptional() @IsIn(['week','month','year']) period?: ReportPeriodKind;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) anchor?: string;
}
