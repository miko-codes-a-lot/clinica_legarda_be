import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { Appointment } from '../appointments/entities/appointment.entity';
import { AppointmentReminder } from './entities/appointment-reminder.entity';
import { MailerService } from '../mailer/mailer.service';

describe('Reminder worker lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  async function worker(enabled = false) {
    const module = await Test.createTestingModule({ providers: [
      AppointmentRemindersService,
      { provide: ConfigService, useValue: new ConfigService({ appointmentReminders: { enabled } }) },
      { provide: getModelToken(Appointment.name), useValue: {} },
      { provide: getModelToken(AppointmentReminder.name), useValue: {} },
      { provide: MailerService, useValue: {} },
    ] }).compile();
    const service = module.get(AppointmentRemindersService);
    const scan = jest.spyOn(service, 'sendDueReminders').mockResolvedValue();
    return { module, service, scan };
  }

  it('does not schedule delivery unless explicitly enabled', async () => {
    const { module, service, scan } = await worker();
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(scan).not.toHaveBeenCalled();
    await module.close();
  });

  it('runs immediately and every minute, then stops when the application closes', async () => {
    const { module, service, scan } = await worker(true);
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(scan).toHaveBeenCalledTimes(2);
    await module.close();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('does not overlap a slow batch and recovers after it fails', async () => {
    const { module, service, scan } = await worker(true);
    let rejectBatch: (error: Error) => void = () => {};
    scan.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectBatch = reject; }));
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(scan).toHaveBeenCalledTimes(1);
    rejectBatch(new Error('Temporary database failure'));
    await jest.advanceTimersByTimeAsync(60_000);
    expect(scan).toHaveBeenCalledTimes(2);
    await module.close();
  });
});
