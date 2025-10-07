import { PartialType } from '@nestjs/mapped-types';
import { CreateDentalCatalogDto } from './create-dental-catalog.dto';

export class UpdateDentalCatalogDto extends PartialType(CreateDentalCatalogDto) {}
