import { IsDateString, IsIn, IsMongoId, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class VisitTransitionDto {
  @IsIn(['in_progress', 'cancelled']) state: 'in_progress' | 'cancelled';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class VisitQueryDto {
  @IsOptional() @IsMongoId() clinic?: string;
  @IsOptional() @IsMongoId() patient?: string;
  @IsOptional() @IsMongoId() appointment?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
}
