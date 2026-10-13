import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import request = require('supertest');
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { MailerService } from '../mailer/mailer.service';

jest.mock('googleapis', () => ({ google: {
  auth: { OAuth2: class { setCredentials() {} } },
  gmail: () => ({ users: { messages: { send: async () => ({ data: { id: 'captured' } }) } } }),
} }));
jest.mock('../_shared/configuration', () => ({ __esModule: true, default: () => ({
  gmail: { clientId: 'test', clientSecret: 'test', refreshToken: 'test', from: 'sender@clinic-mail.ph',
    sendingPausedUntil: '2099-01-01T00:00:00Z' },
}) }));

describe('Login while email sending is temporarily paused', () => {
  let app: INestApplication;
  const generate = jest.fn().mockResolvedValue('123456');
  const sign = jest.fn().mockResolvedValue('test-session');

  beforeAll(async () => {
    const auth = new AuthService({ signAsync: sign } as unknown as JwtService, {
      findForSignIn: async () => ({ _id: '64b000000000000000000001', username: 'patient',
        password: await bcrypt.hash('test-password', 4), role: 'user', status: 'confirmed',
        emailAddress: 'patient@clinic-mail.ph' }),
    } as unknown as UsersService, { generate } as unknown as OtpService, new MailerService());
    const module = await Test.createTestingModule({ controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }] }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('returns a clear HTTP503 before creating an OTP or partial login token', async () => {
    const response = await request(app.getHttpServer()).post('/auth/sign-in')
      .send({ username: 'patient', password: 'test-password' }).expect(503);
    expect(response.body.message).toMatch(/email.*temporarily unavailable/i);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });
});
