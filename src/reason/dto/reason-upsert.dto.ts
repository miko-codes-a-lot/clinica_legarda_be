import { IsString, IsOptional, IsEnum, IsBoolean, IsNumber } from 'class-validator';
import { ReasonUsage } from '../entities/reason.entity';

export class ReasonUpsertDto {
  @IsOptional()
  @IsString()
  _id?: string; // if provided, will update existing reason

  @IsOptional()
  @IsString()
  code?: string; // e.g. "NO_AVAILABLE_SLOT"

  @IsOptional()
  @IsString()
  label?: string; // e.g. "No available schedule"

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ReasonUsage)
  usage?: ReasonUsage; // referral | decline | both

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
