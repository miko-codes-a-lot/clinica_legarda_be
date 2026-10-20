import { ConfigService } from '@nestjs/config';
import { AppointmentsService } from './appointments.service';
import { RescheduleExpiryService } from './reschedule-expiry.service';

describe('Unanswered proposal expiry worker', () => {
  let worker: RescheduleExpiryService;
  let scan: jest.Mock<Promise<number>, [Date]>;
  beforeEach(() => {
    jest.useFakeTimers();
    scan = jest.fn().mockResolvedValue(0);
  });
  afterEach(() => {
    worker?.onModuleDestroy();
    jest.useRealTimers();
  });
  const start = (enabled: boolean) => {
    worker = new RescheduleExpiryService(
      { expireRescheduleProposals: scan } as unknown as AppointmentsService,
      new ConfigService({ appointmentRescheduleExpiry: { enabled } }),
    );
    worker.onApplicationBootstrap();
  };
  it('requires explicit opt-in and stops scanning on shutdown', async () => {
    start(false);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(scan).not.toHaveBeenCalled();
    start(true);
    expect(scan).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(scan).toHaveBeenCalledTimes(2);
    worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(scan).toHaveBeenCalledTimes(2);
  });
  it('does not overlap a slow expiry scan', async () => {
    let finish!: (value: number) => void;
    scan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    start(true);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(scan).toHaveBeenCalledTimes(1);
    finish(0);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(scan).toHaveBeenCalledTimes(2);
  });
  it('retries the next interval after a scan fails', async () => {
    scan.mockRejectedValueOnce(new Error('Temporary database failure'));
    start(true);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(scan).toHaveBeenCalledTimes(2);
  });
});
