import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentsService } from './appointments.service';

@Injectable()
export class RescheduleExpiryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(RescheduleExpiryService.name);
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly config: ConfigService,
  ) {}
  onApplicationBootstrap(): void {
    if (!this.config.get<boolean>('appointmentRescheduleExpiry.enabled'))
      return;
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref();
    this.logger.log('Unanswered reschedule proposal expiry enabled.');
    void this.tick();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.appointments.expireRescheduleProposals(new Date());
    } catch {
      this.logger.warn(
        'Proposal expiry scan failed; retrying on the next interval.',
      );
    } finally {
      this.running = false;
    }
  }
}
