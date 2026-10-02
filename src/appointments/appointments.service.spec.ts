import { ForbiddenException } from '@nestjs/common';
import { User } from '../users/entities/user.entity';
import { Referral } from '../referral/entities/referral.entity';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { model } from 'mongoose';
import { AppointmentsService } from './appointments.service';
import { Appointment, AppointmentSchema } from './entities/appointment.entity';
import { AppointmentSchedulingService } from './appointment-scheduling.service';
import { AppointmentStatus } from '../_shared/enum/appointment-status.enum';
import { TreatmentCase } from '../care/entities/treatment-case.entity';
import { Visit } from '../care/entities/visit.entity';

describe('Appointment changes', () => {
  const actor = { sub: '000000000000000000000002', role: 'user' };
  const AppointmentModel = model('AppointmentChangeTest', AppointmentSchema);
  let service: AppointmentsService;
  let current: InstanceType<typeof AppointmentModel>;
  let update: jest.Mock;
  let findOne: jest.Mock;

  beforeEach(async () => {
    current = new AppointmentModel({
      createdBy: actor.sub,
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
      { provide: getModelToken(Referral.name), useValue: {} },
      { provide: getModelToken(User.name), useValue: { exists: () => ({ session: async () => ({ _id: actor.sub }) }) } },
      { provide: getModelToken(TreatmentCase.name), useValue: {} },
      { provide: getModelToken(Visit.name), useValue: { exists: () => ({ session: async () => null }) } },
      { provide: getModelToken(Appointment.name), useValue: {
        findById: () => {
          const query = { session: () => query, populate: () => query, exec: async () => current };
          return query;
        }, findOne, findByIdAndUpdate: update, findOneAndUpdate: update,
      } },
      { provide: AppointmentSchedulingService, useValue: {
        withLocks: async (_ids: string[], work: (session: unknown) => Promise<unknown>) => work({}),
        validate: jest.fn().mockImplementation(async (request) => request),
      } },
    ] }).compile();
    service = module.get(AppointmentsService);
  });

  it('persists a cancellation reason in appointment history', async () => {
    const result = await service.cancel(current.id, actor, '  Work conflict  ');
    expect(result.status).toBe(AppointmentStatus.CANCELLED);
    expect(result.history.at(-1)).toMatchObject({ reason: 'Work conflict' });
  });

  it('allows cancellation even when another appointment occupies the slot', async () => {
    findOne.mockResolvedValue({});
    await expect(service.cancel(current.id, actor)).resolves.toMatchObject({ status: AppointmentStatus.CANCELLED });
  });

  it.each([
    { sub: '000000000000000000000003', role: 'dentist' },
    { sub: '000000000000000000000004', role: 'admin', clinics: ['000000000000000000000001'] },
    { sub: '000000000000000000000005', role: 'super-admin' },
  ])('does not let a non-creator $role cancel a patient booking', async other => {
    await expect(service.cancel(current.id, other, 'Schedule conflict')).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    expect(current.status).toBe(AppointmentStatus.CONFIRMED);
  });

  it('does not let the patient cancel a booking created by staff', async () => {
    current.set('createdBy', '000000000000000000000004');
    await expect(service.cancel(current.id, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('uses the original attributed creation event for existing bookings', async () => {
    current.set('createdBy', undefined);
    current.set('history', [
      { action: 'Appointment created.', actorId: actor.sub },
      { action: 'Appointment approved.', actorId: '000000000000000000000003' },
    ]);
    await expect(service.cancel(current.id, actor)).resolves.toMatchObject({ status: AppointmentStatus.CANCELLED });
  });

  it('does not guess the creator from the patient or later activity', async () => {
    current.set('createdBy', undefined);
    current.set('history', [{ action: 'Appointment rescheduled.', actorId: actor.sub }]);
    await expect(service.cancel(current.id, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('persists a reschedule reason while returning the appointment to pending', async () => {
    const result = await service.reschedule(current.id, {
      date: new Date('2026-09-16'), startTime: '11:00', endTime: '12:00',
      patient: '000000000000000000000002', dentist: '000000000000000000000003',
      ...{ reason: '  Travel plans changed  ' },
    }, actor);
    expect(result.status).toBe(AppointmentStatus.PENDING);
    expect(result.date.toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(result.history.at(-1)).toMatchObject({ reason: 'Travel plans changed' });
  });
});
