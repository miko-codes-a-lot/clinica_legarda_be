import {
  IsNotEmpty,
  IsArray,
  IsMongoId,
  ArrayUnique,
  IsNumber,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class DentalCatalogUpsertDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  name: string;

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  duration: number;

  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  clinics: string[];
}
