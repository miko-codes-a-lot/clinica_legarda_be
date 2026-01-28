import { Test, TestingModule } from '@nestjs/testing';
import { ReasonController } from './reason.controller';
import { ReasonService } from './reason.service';

describe('ReasonController', () => {
  let controller: ReasonController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReasonController],
      providers: [ReasonService],
    }).compile();

    controller = module.get<ReasonController>(ReasonController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
