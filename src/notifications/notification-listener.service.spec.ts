import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotificationListenerService } from './notification-listener.service';
import { NotificationsService } from './notifications.service';
import { UsersService } from '../users/users.service';
import { Appointment } from '../appointments/entities/appointment.entity';

describe('Appointment change notifications', () => {
  let onChange: (change: object) => void;
  let createMany: jest.Mock;
  const appointment = {
    _id: 'appointment-1', status: 'pending', date: new Date('2026-09-16'),
    startTime: '11:00', endTime: '12:00',
    patient: { _id: 'patient-1', firstName: 'Maria', lastName: 'Santos' },
    dentist: { _id: 'dentist-1', firstName: 'Juan', lastName: 'Cruz' },
  };
  beforeEach(async () => {
    createMany = jest.fn().mockResolvedValue([]);
    const module = await Test.createTestingModule({ providers: [NotificationListenerService,
      { provide: getModelToken(Appointment.name), useValue: {
        collection: { watch: () => ({ on: (_event: string, listener: typeof onChange) => { onChange = listener; } }) },
        findById: () => ({ populate: async () => appointment }),
      } },
      { provide: NotificationsService, useValue: { createMany } },
      { provide: UsersService, useValue: { notificationStaffRecipients: async () => [] } },
    ] }).compile();
    module.get(NotificationListenerService).onModuleInit();
  });

  it('notifies the dentist of a reschedule even when status stays pending', async () => {
    onChange({ operationType: 'update', documentKey: { _id: 'appointment-1' },
      updateDescription: { updatedFields: { date: appointment.date, startTime: '11:00' } } });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(createMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ recipient: 'dentist-1', message: expect.stringContaining('rescheduled'),
        link: '/dentist/appointment/details/appointment-1' }),
      expect.objectContaining({ recipient: 'patient-1', link: '/app/my-appointment' }),
    ]));
  });
});
