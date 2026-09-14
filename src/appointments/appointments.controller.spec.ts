import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { UserActor } from '../auth/role-policy';

describe('Appointment change HTTP contracts', () => {
  let app: INestApplication;
  const actor: UserActor = { sub: '000000000000000000000002', role: 'user' };
  const cancel = jest.fn((id: string, _actor: UserActor, reason?: string) => ({ _id: id, reason }));
  const reschedule = jest.fn((id: string, dto: object) => ({ _id: id, ...dto }));
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [{ provide: AppointmentsService, useValue: { cancel, reschedule } }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: { user?: UserActor }, _res: unknown, next: () => void) => {
      req.user = actor;
      next();
    });
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => { cancel.mockClear(); reschedule.mockClear(); });

  it('passes a cancellation reason through the HTTP endpoint', async () => {
    await request(app.getHttpServer()).patch('/appointments/a1/cancel')
      .send({ reason: 'Work conflict' }).expect(200).expect({ _id: 'a1', reason: 'Work conflict' });
    expect(cancel).toHaveBeenCalledWith('a1', actor, 'Work conflict');
  });
  it.each(['', '   ', null, 17, 'x'.repeat(501)])('rejects invalid cancellation reason %p', async reason => {
    await request(app.getHttpServer()).patch('/appointments/a1/cancel').send({ reason }).expect(400);
    expect(cancel).not.toHaveBeenCalled();
  });
  it('preserves compatibility for older clients that omit a reason', async () => {
    await request(app.getHttpServer()).patch('/appointments/a1/cancel').send({}).expect(200);
  });
  it('validates the reason on reschedules as well as cancellations', async () => {
    await request(app.getHttpServer()).patch('/appointments/a1/reschedule').send({
      date: '2026-09-16', startTime: '11:00', endTime: '12:00', patient: 'p1', dentist: 'd1', reason: '   ',
    }).expect(400);
    expect(reschedule).not.toHaveBeenCalled();
  });
  it('passes the reason and chosen schedule to the reschedule service', async () => {
    await request(app.getHttpServer()).patch('/appointments/a1/reschedule').send({
      date: '2026-09-16', startTime: '11:00', endTime: '12:00', patient: 'p1', dentist: 'd1', reason: 'Travel plans',
    }).expect(200);
    expect(reschedule).toHaveBeenCalledWith('a1', expect.objectContaining({ reason: 'Travel plans', startTime: '11:00' }), actor);
  });
});
