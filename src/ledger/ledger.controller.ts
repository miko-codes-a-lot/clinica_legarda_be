import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { User } from '../_shared/decorators/user.decorator';
import { UserActor } from '../auth/role-policy';
import { LedgerService } from './ledger.service';
import { LedgerChargeDto, LedgerClinicQueryDto, LedgerPaymentDto } from './dto/ledger-entry.dto';
import { InstallmentPlanDto, ReviseInstallmentPlanDto } from './dto/installment-plan.dto';
import { VoidEntryDto } from './dto/void-entry.dto';
@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}
  @Get('my-record') own(@User() actor: UserActor) { return this.ledger.record(actor, actor.sub, undefined, true); }
  @Get('patients/:id') record(@User() actor: UserActor, @Param('id') id: string, @Query() query: LedgerClinicQueryDto) { return this.ledger.record(actor, id, query.clinic); }
  @Post('charges') charge(@User() actor: UserActor, @Body() dto: LedgerChargeDto) { return this.ledger.charge(actor, dto); }
  @Post('payments') payment(@User() actor: UserActor, @Body() dto: LedgerPaymentDto) { return this.ledger.payment(actor, dto); }
  @Patch('entries/:id/void') void(@User() actor: UserActor, @Param('id') id: string, @Body() dto: VoidEntryDto) { return this.ledger.void(actor, id, dto.reason); }
  @Post('installments') installments(@User() actor: UserActor, @Body() dto: InstallmentPlanDto) { return this.ledger.installments(actor, dto); }
  @Patch('installments/:id') revise(@User() actor: UserActor, @Param('id') id: string, @Body() dto: ReviseInstallmentPlanDto) { return this.ledger.revise(actor, id, dto); }
}
