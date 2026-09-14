import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { RtNotificationsGateway } from './rt-notifications.gateway';

describe('Notification transport behind the API proxy', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ providers: [RtNotificationsGateway,
      { provide: AuthService, useValue: { verifyJwt: async () => ({ sub: 'dentist-1' }) } },
    ] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
  });
  afterAll(() => app.close());

  it('accepts a Socket.IO handshake under the proxied API path', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/socket.io/?EIO=4&transport=polling').expect(200);
    expect(response.text.startsWith('0')).toBe(true);
    const handshake = JSON.parse(response.text.slice(1)) as { sid: string; upgrades: string[] };
    expect(handshake.sid).toEqual(expect.any(String));
    expect(handshake.upgrades).toContain('websocket');
  });
});
