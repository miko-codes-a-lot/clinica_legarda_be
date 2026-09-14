import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { model } from 'mongoose';
import { AppointmentsService } from './appointments.service';
import { Appointment, AppointmentSchema } from './entities/appointment.entity';
import { AppointmentSchedulingService } from './appointment-scheduling.service';
import { AppointmentStatus } from '../_shared/enum/appointment-status.enum';

describe('Appointment changes', () => {
  const AppointmentModel = model('AppointmentChangeTest', AppointmentSchema);
  let service: AppointmentsService;
  let current: InstanceType<typeof AppointmentModel>;
  let update: jest.Mock;
  let findOne: jest.Mock;

  beforeEach(async () => {
    current = new AppointmentModel({
      clinic: '000000000000000000000001', patient: '000000000000000000000002',
      dentist: '000000000000000000000003', date: new Date('2026-09-15'),
      startTime: '09:00', endTime: '10:00', status: AppointmentStatus.CONFIRMED,
    });
    findOne = jest.fn().mockImplementation(() => ({
      populate: () => Promise.resolve(null), then: (resolve: (value: null) => void) => resolve(null),
    }));
    update = jest.fn().mockImplementation((_id: string, payload: { $set: object; $push: { history: object } }) => {
      current.set(payload.$set);
      current.set('history', [...current.history, payload.$push.history]);
      const query = { populate: () => query, exec: async () => current };
      return query;
    });
    const module = await Test.createTestingModule({ providers: [AppointmentsService,
      { provide: getModelToken(Appointment.name), useValue: {
        findById: () => {
          const query = { session: () => query, populate: () => query, exec: async () => current };
          return query;
        }, findOne, findByIdAndUpdate: update,
      } },
      { provide: AppointmentSchedulingService, useValue: {
        withLocks: async (_ids: string[], work: (session: unknown) => Promise<unknown>) => work({}),
        validate: jest.fn().mockResolvedValue(undefined),
      } },
    ] }).compile();
    service = module.get(AppointmentsService);
  });

  it('persists a cancellation reason in appointment history', async () => {
    const result = await service.cancel(current.id, '  Work conflict  ');
    expect(result.status).toBe(AppointmentStatus.CANCELLED);
    expect(result.history.at(-1)).toMatchObject({ reason: 'Work conflict' });
  });

  it('allows cancellation even when another appointment occupies the slot', async () => {
    findOne.mockResolvedValue({});
    await expect(service.cancel(current.id)).resolves.toMatchObject({ status: AppointmentStatus.CANCELLED });
  });

  it('persists a reschedule reason while returning the appointment to pending', async () => {
    const result = await service.reschedule(current.id, {
      date: new Date('2026-09-16'), startTime: '11:00', endTime: '12:00',
      patient: '000000000000000000000002', dentist: '000000000000000000000003',
      ...{ reason: '  Travel plans changed  ' },
    });
    expect(result.status).toBe(AppointmentStatus.PENDING);
    expect(result.date.toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(result.history.at(-1)).toMatchObject({ reason: 'Travel plans changed' });
  });
});
