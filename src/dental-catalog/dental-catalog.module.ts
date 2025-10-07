import { Module } from '@nestjs/common';
import { DentalCatalogService } from './dental-catalog.service';
import { DentalCatalogController } from './dental-catalog.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DentalCatalog,
  DentalCatalogSchema,
} from './entities/dental-catalog.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DentalCatalog.name, schema: DentalCatalogSchema },
    ]),
  ],
  controllers: [DentalCatalogController],
  providers: [DentalCatalogService],
})
export class DentalCatalogModule {}
