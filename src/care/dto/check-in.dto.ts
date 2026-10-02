import { IsBoolean, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { VisitPurpose } from '../entities/visit.entity';

export class CheckInDto {
  @IsMongoId() patient: string;
  @IsMongoId() clinic: string;
  @IsMongoId() dentist: string;
  @IsOptional() @IsMongoId() appointment?: string;
  @IsIn(['consultation', 'treatment']) purpose: VisitPurpose;
  @IsOptional() @IsBoolean() isWalkIn?: boolean;
}
