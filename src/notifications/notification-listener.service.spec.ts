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
    _id: 'appointment-1', clinic: 'clinic-1', status: 'pending', date: new Date('2026-09-16'),
    startTime: '11:00', endTime: '12:00',
    patient: { _id: 'patient-1', firstName: 'Maria', lastName: 'Santos' },
    dentist: { _id: 'dentist-1', firstName: 'Juan', lastName: 'Cruz' },
  };
  beforeEach(async () => {
    Object.assign(appointment, {status:'pending',scheduleVersion:0,rescheduleProposal:undefined,history:[]});
    createMany = jest.fn().mockResolvedValue([]);
    const module = await Test.createTestingModule({ providers: [NotificationListenerService,
      { provide: getModelToken(Appointment.name), useValue: {
        collection: { watch: () => ({ on: (_event: string, listener: typeof onChange) => { onChange = listener; } }) },
        findById: () => ({ populate: async () => appointment }),
      } },
      { provide: NotificationsService, useValue: { createMany } },
      { provide: UsersService, useValue: { notificationStaffRecipients: async () => [], notificationPatientRecipient: async () => ({ id: 'patient-1' }) } },
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
  it.each(['completed', 'no_show', 'confirmed'])('notifies both participants of %s without assuming the dentist acted', async (status) => {
    appointment.status = status;
    onChange({ operationType: 'update', documentKey: { _id: 'appointment-1' }, updateDescription: { updatedFields: { status } } });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(createMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ recipient: 'patient-1', link: '/app/my-appointment' }),
      expect.objectContaining({ recipient: 'dentist-1', link: '/dentist/appointment/details/appointment-1', message: expect.not.stringContaining('You have confirmed') }),
    ]));
  });

  it('suppresses an old proposal stream event after its version or status was superseded', async () => {
    Object.assign(appointment, {status:'confirmed',scheduleVersion:2,rescheduleProposal:undefined});
    onChange({operationType:'update',documentKey:{_id:'appointment-1'},updateDescription:{updatedFields:{status:'pending',scheduleVersion:1,rescheduleProposal:{id:'old'}}}});
    await new Promise<void>(resolve=>setImmediate(resolve));expect(createMany).not.toHaveBeenCalled();
  });
  it('tells the patient that a current clinic proposal needs their response', async () => {
    Object.assign(appointment, {status:'pending',scheduleVersion:1,rescheduleProposal:{id:'current'}});
    onChange({operationType:'update',documentKey:{_id:'appointment-1'},updateDescription:{updatedFields:{status:'pending',scheduleVersion:1,rescheduleProposal:{id:'current'},startTime:'11:00'}}});
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(createMany).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({recipient:'patient-1',message:expect.stringContaining('accept')})]));
  });
  it('notifies the clinic when a patient returns a proposal for another time even if status stays pending', async () => {
    Object.assign(appointment, {status:'pending',scheduleVersion:2,rescheduleProposal:undefined,history:[{actorRole:'user',action:'Appointment rescheduled.'}]});
    onChange({operationType:'update',documentKey:{_id:'appointment-1'},updateDescription:{updatedFields:{scheduleVersion:2},removedFields:['rescheduleProposal']}});
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(createMany).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({recipient:'dentist-1',message:expect.stringContaining('review')})]));
  });

  it('includes the Manila check-in deadline on confirmation', async () => {
    appointment.status = 'confirmed';
    onChange({ operationType: 'update', documentKey: { _id: 'appointment-1' }, updateDescription: { updatedFields: { status: 'confirmed' } } });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(createMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ recipient: 'patient-1', message: expect.stringContaining('11:20 AM') }),
    ]));
  });

  it.each([
    {status:'confirmed',copy:'Check in by'},
    {status:'cancelled',copy:'has been cancelled'},
  ])('uses $status copy when a proposal is removed',async({status,copy})=>{
    Object.assign(appointment,{status,history:[{action:'Latest decision'}]});
    onChange({operationType:'update',documentKey:{_id:'appointment-1'},updateDescription:{updatedFields:{status,'history.0':{action:'Latest decision'}},removedFields:['rescheduleProposal']}});
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(createMany).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({recipient:'patient-1',message:expect.stringContaining(copy)})]));
  });
  it.each([
    {'history.1':{action:'Old acceptance'}},
    {history:[{action:'Original'},{action:'Old acceptance'}]},
  ])('ignores a delayed status event after a later proposal was also accepted (%j)',async(historyFields)=>{
    Object.assign(appointment,{status:'confirmed',scheduleVersion:2,history:[{action:'Original'},{action:'Old acceptance'},{action:'New proposal'},{action:'New acceptance'}]});
    onChange({operationType:'update',documentKey:{_id:'appointment-1'},updateDescription:{updatedFields:{status:'confirmed',...historyFields},removedFields:['rescheduleProposal']}});
    await new Promise<void>(resolve=>setImmediate(resolve));expect(createMany).not.toHaveBeenCalled();
  });

  it('keeps a valid confirmation and its actor when a later clinical note is saved',async()=>{
    Object.assign(appointment,{status:'confirmed',history:[{action:'Patient accepted the proposed schedule.',actorRole:'user',actorId:'patient-1'},{action:'Clinical notes updated.',actorRole:'dentist',actorId:'dentist-1'}]});
    onChange({operationType:'update',documentKey:{_id:'appointment-1'},updateDescription:{updatedFields:{status:'confirmed','history.0':{action:'Patient accepted the proposed schedule.'}},removedFields:['rescheduleProposal']}});
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(createMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({recipient:'patient-1',message:expect.stringContaining('Check in by')}),
      expect.objectContaining({recipient:'dentist-1',message:expect.stringContaining('confirmed')}),
    ]));
  });

});
