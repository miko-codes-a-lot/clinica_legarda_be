import { Test, TestingModule } from '@nestjs/testing';
import { RtNotificationsGateway } from './rt-notifications.gateway';

describe('RtNotificationsGateway', () => {
  let gateway: RtNotificationsGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RtNotificationsGateway],
    }).compile();

    gateway = module.get<RtNotificationsGateway>(RtNotificationsGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
