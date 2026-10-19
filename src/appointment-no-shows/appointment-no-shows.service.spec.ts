import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { AppointmentNoShowsService } from './appointment-no-shows.service';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { Appointment } from '../appointments/entities/appointment.entity';
import { Visit } from '../care/entities/visit.entity';
import { User } from '../users/entities/user.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { ClinicClosure } from '../clinic-closures/entities/clinic-closure.entity';
import { DentistDayAvailability } from '../dentist-availability/entities/dentist-day-availability.entity';
describe('No-show worker lifecycle', () => {
  beforeEach(() => jest.useFakeTimers()); afterEach(() => jest.useRealTimers());
  async function setup(enabled: boolean, enforceFrom?: string) {
    const module = await Test.createTestingModule({ providers: [AppointmentNoShowsService,
      { provide: ConfigService, useValue: new ConfigService({ appointmentNoShows: { enabled, enforceFrom } }) },
      { provide: AppointmentSchedulingService, useValue: {} },
      ...[Appointment, Visit, User, Clinic, ClinicClosure, DentistDayAvailability].map(model => ({ provide: getModelToken(model.name), useValue: {} })),
    ] }).compile();
    const service = module.get(AppointmentNoShowsService), scan = jest.spyOn(service, 'applyDueNoShows').mockResolvedValue(0);
    return { module, service, scan };
  }
  it('does not run with disabled, missing or invalid activation settings', async () => {
    for (const [enabled, value] of [[false, '2026-10-20T00:00:00Z'], [true, undefined], [true, '2026-10-20']] as const) {
      const { module, service, scan } = await setup(enabled, value); service.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(60_000); expect(scan).not.toHaveBeenCalled(); await module.close();
    }
  });
  it('scans immediately, avoids overlap, recovers after failure and stops on shutdown', async () => {
    const { module, service, scan } = await setup(true, '2026-10-20T00:00:00Z');
    let fail: (error: Error) => void = () => {};
    scan.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    service.onApplicationBootstrap(); await jest.advanceTimersByTimeAsync(60_000); expect(scan).toHaveBeenCalledTimes(1);
    fail(new Error('Database unavailable')); await jest.advanceTimersByTimeAsync(30_000); expect(scan).toHaveBeenCalledTimes(2);
    await module.close(); await jest.advanceTimersByTimeAsync(60_000); expect(scan).toHaveBeenCalledTimes(2);
  });
});
