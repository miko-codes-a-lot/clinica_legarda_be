import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import * as request from 'supertest';
import { ReasonController } from './reason.controller';
import { ReasonService } from './reason.service';
import { ReasonDocument, ReasonUsage } from './entities/reason.entity';

describe('Retired reason management with historical lookup', () => {
  let app: INestApplication;
  const records = [
    { code: 'SPECIALIST', label: 'Specialist consultation', isActive: true },
    { code: 'X', label: 'Legacy patient request', isActive: false },
  ];
  const find = jest.fn(() => ({ sort: jest.fn().mockResolvedValue(records) }));
  const create = jest.fn().mockResolvedValue({});
  const update = jest.fn().mockResolvedValue({});
  const byId = jest.fn().mockResolvedValue({ isActive: true, save: jest.fn().mockResolvedValue({}) });

  beforeAll(async () => {
    const model = { find, create, findByIdAndUpdate: update, findById: byId } as unknown as Model<ReasonDocument>;
    const module = await Test.createTestingModule({
      controllers: [ReasonController],
      providers: [{ provide: ReasonService, useValue: new ReasonService(model) }],
    }).compile();
    app = module.createNestApplication();
    // Keep authentication outside this route test; exercise every former management role.
    app.use((req, _res, next) => { req.user = { role: req.headers['x-role'], sub: 'fixture-staff' }; next(); });
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => { await app.close(); });

  it('reads inactive historical labels without filtering them out', async () => {
    const response = await request(app.getHttpServer()).get('/reasons').expect(200);
    expect(response.body).toEqual(records);
    expect(find).toHaveBeenCalledWith({});
  });

  it('retains optional usage filtering for existing readers', async () => {
    await request(app.getHttpServer()).get('/reasons?usage=referral').expect(200);
    expect(find).toHaveBeenCalledWith({ $or: [{ usage: ReasonUsage.REFERRAL }, { usage: ReasonUsage.BOTH }] });
  });

  it.each(['user', 'dentist', 'admin', 'super-admin'])('does not expose reason management to %s', async role => {
    await request(app.getHttpServer()).post('/reasons').set('x-role', role).send({ code: 'NEW', label: 'New reason' }).expect(404);
    await request(app.getHttpServer()).put('/reasons/fixture').set('x-role', role).send({ label: 'Changed' }).expect(404);
    await request(app.getHttpServer()).patch('/reasons/fixture/toggle').set('x-role', role).expect(404);
    await request(app.getHttpServer()).delete('/reasons/fixture').set('x-role', role).expect(404);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(byId).not.toHaveBeenCalled();
  });
});
