import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  IsEnum,
  IsStrongPassword,
  IsIn,
} from 'class-validator';
import { OperatingHourDto } from 'src/_shared/dto/operating-hour.dto';
import { UserStatus } from 'src/_shared/enum/user-status.enum';
import {
  PASSWORD_REQUIREMENTS,
  PASSWORD_REQUIREMENTS_MESSAGE,
} from 'src/_shared/validation/password-policy';

export class UserUpsertDto {
  @IsNotEmpty()
  firstName: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsNotEmpty()
  lastName: string;

  @IsNotEmpty()
  username: string;

  @IsOptional()
  @IsNotEmpty()
  @IsStrongPassword(PASSWORD_REQUIREMENTS, {
    message: PASSWORD_REQUIREMENTS_MESSAGE,
  })
  password?: string;

  @IsNotEmpty()
  @IsEmail()
  emailAddress: string;

  @IsNotEmpty()
  mobileNumber: string;

  @IsNotEmpty()
  address: string;

  @IsOptional()
  @IsMongoId()
  clinic?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  clinics?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OperatingHourDto)
  operatingHours?: OperatingHourDto[];

  @IsOptional()
  @IsString()
  @IsIn(['user', 'dentist', 'admin', 'super-admin'])
  role: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
