import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Put,
} from '@nestjs/common';
import { DentalCatalogService } from './dental-catalog.service';
import { DentalCatalogUpsertDto } from './dto/dental-catalog-upsert.dto';

@Controller('dental-catalog')
export class DentalCatalogController {
  constructor(private readonly dentalCatalogService: DentalCatalogService) {}

  @HttpCode(HttpStatus.CREATED)
  @Post()
  create(@Body() doc: DentalCatalogUpsertDto) {
    return this.dentalCatalogService.upsert(doc);
  }
  
  @HttpCode(HttpStatus.OK)
  @Get()
  findAll() {
    return this.dentalCatalogService.findAll();
  }

  @HttpCode(HttpStatus.OK)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dentalCatalogService.findOne(id);
  }

  @HttpCode(HttpStatus.OK)
  @Put(':id')
  update(@Param('id') id: string, @Body() doc: DentalCatalogUpsertDto) {
    return this.dentalCatalogService.upsert(doc, id);
  }
}
