import { Test, TestingModule } from '@nestjs/testing';
import { DentalCatalogController } from './dental-catalog.controller';
import { DentalCatalogService } from './dental-catalog.service';

describe('DentalCatalogController', () => {
  let controller: DentalCatalogController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DentalCatalogController],
      providers: [DentalCatalogService],
    }).compile();

    controller = module.get<DentalCatalogController>(DentalCatalogController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
