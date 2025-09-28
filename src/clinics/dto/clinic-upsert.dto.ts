import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { OperatingHourDto } from 'src/_shared/dto/operating-hour.dto';

export class ClinicUpsertDto {
  @IsNotEmpty()
  name: string

  @IsNotEmpty()
  address: string

  @IsNotEmpty()
  mobileNumber: string

  @IsNotEmpty()
  @IsEmail()
  emailAddress: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OperatingHourDto)
  operatingHours?: OperatingHourDto[]
}
