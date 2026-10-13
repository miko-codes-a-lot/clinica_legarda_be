import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Put,
  Query,
} from '@nestjs/common';
import { DentalCatalogService } from './dental-catalog.service';
import { DentalCatalogUpsertDto } from './dto/dental-catalog-upsert.dto';

import { User } from '../_shared/decorators/user.decorator';
import { UserDto } from '../auth/dto/user.dto';

@Controller('dental-catalog')
export class DentalCatalogController {
  constructor(private readonly dentalCatalogService: DentalCatalogService) {}

  @HttpCode(HttpStatus.CREATED)
  @Post()
  create(@Body() doc: DentalCatalogUpsertDto, @User() actor: UserDto) {
    return this.dentalCatalogService.upsert(doc, undefined, actor);
  }
  
  @HttpCode(HttpStatus.OK)
  @Get()
  findAll(@User() actor: UserDto, @Query('clinic') clinic?: string) {
    return this.dentalCatalogService.findAll(actor, clinic);
  }

  @HttpCode(HttpStatus.OK)
  @Get(':id')
  findOne(@Param('id') id: string, @User() actor: UserDto) {
    return this.dentalCatalogService.findOne(id, actor);
  }

  @HttpCode(HttpStatus.OK)
  @Put(':id')
  update(@Param('id') id: string, @Body() doc: DentalCatalogUpsertDto, @User() actor: UserDto) {
    return this.dentalCatalogService.upsert(doc, id, actor);
  }
}
