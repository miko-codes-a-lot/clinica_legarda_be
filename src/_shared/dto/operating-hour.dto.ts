import { IsNotEmpty } from 'class-validator'

export class OperatingHourDto {
  @IsNotEmpty()
  day: string
  
  @IsNotEmpty()
  startTime: string

  @IsNotEmpty()
  endTime: string
}