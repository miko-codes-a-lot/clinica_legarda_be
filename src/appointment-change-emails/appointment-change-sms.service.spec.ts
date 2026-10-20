import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AppointmentChangeSmsService } from './appointment-change-sms.service';
import { AppointmentChangeEmail } from './entities/appointment-change-email.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { User } from '../users/entities/user.entity';
import { SmsService } from '../sms/sms.service';

describe('Change text worker lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  async function worker(enabled = false) {
    const module = await Test.createTestingModule({ providers: [
      AppointmentChangeSmsService,
      { provide: ConfigService, useValue: new ConfigService({ appointmentSms: { enabled } }) },
      { provide: getModelToken(AppointmentChangeEmail.name), useValue: {} },
      { provide: getModelToken(User.name), useValue: {} },
      { provide: getModelToken(Clinic.name), useValue: {} },
      { provide: getModelToken(Appointment.name), useValue: {} },
      { provide: SmsService, useValue: {} },
    ] }).compile();
    const service = module.get(AppointmentChangeSmsService);
    const scan = jest.spyOn(service, 'sendPending').mockResolvedValue();
    return { module, service, scan };
  }

  it('does not schedule delivery unless texts are explicitly enabled', async () => {
    const { module, service, scan } = await worker();
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(scan).not.toHaveBeenCalled();
    await module.close();
  });

  it('runs immediately and every 15 seconds, then stops when the application closes', async () => {
    const { module, service, scan } = await worker(true);
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(15_000);
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
    await jest.advanceTimersByTimeAsync(60_000);
    expect(scan).toHaveBeenCalledTimes(1);
    rejectBatch(new Error('Temporary database failure'));
    await jest.advanceTimersByTimeAsync(15_000);
    expect(scan).toHaveBeenCalledTimes(2);
    await module.close();
  });
});
