import { Test, TestingModule } from '@nestjs/testing';
import { DentalCatalogService } from './dental-catalog.service';

describe('DentalCatalogService', () => {
  let service: DentalCatalogService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DentalCatalogService],
    }).compile();

    service = module.get<DentalCatalogService>(DentalCatalogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
