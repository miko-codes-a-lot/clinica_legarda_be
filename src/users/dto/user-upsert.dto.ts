import { Type } from "class-transformer";
import { IsArray, IsEmail, IsMongoId, IsNotEmpty, IsOptional, IsString, ValidateNested } from "class-validator";
import { OperatingHourDto } from "src/_shared/dto/operating-hour.dto";

export class UserUpsertDto {
  @IsNotEmpty()
  firstName: string

  @IsOptional()
  @IsString()
  middleName?: string

  @IsNotEmpty()
  lastName: string

  @IsNotEmpty()
  username: string

  @IsOptional()
  @IsNotEmpty()
  password?: string

  @IsNotEmpty()
  @IsEmail()
  emailAddress: string

  @IsNotEmpty()
  mobileNumber: string

  @IsNotEmpty()
  address: string

  @IsNotEmpty()
  @IsMongoId()
  clinic: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OperatingHourDto)
  operatingHours?: OperatingHourDto[]

  @IsString()
  role: string
}
