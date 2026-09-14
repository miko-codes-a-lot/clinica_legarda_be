import { User } from '../_shared/decorators/user.decorator';
import { UserActor } from '../auth/role-policy';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Put,
  Patch,
} from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralUpsertDto } from './dto/referral-upsert.dto';

@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @HttpCode(HttpStatus.OK)
  @Get()
  findAll(@User() actor: UserActor) {
    return this.referralsService.findAll(actor);
  }

  @HttpCode(HttpStatus.OK)
  @Get(':id')
  findOne(@Param('id') id: string, @User() actor: UserActor) {
    return this.referralsService.findOne(id, actor);
  }

  @HttpCode(HttpStatus.CREATED)
  @Post()
  create(@Body() doc: ReferralUpsertDto, @User() actor: UserActor) {
    return this.referralsService.upsert(doc, undefined, actor);
  }

  @HttpCode(HttpStatus.OK)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() doc: ReferralUpsertDto,
    @User() actor: UserActor,
  ) {
    return this.referralsService.upsert(doc, id, actor);
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string, @User() actor: UserActor) {
    return this.referralsService.approve(id, actor);
  }

  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body('reasonOfDecline') reasonOfDecline: string,
    @User() actor: UserActor,
  ) {
    return this.referralsService.reject(reasonOfDecline, id, actor);
  }

  @Get('by-dentist/:dentistId')
  @HttpCode(HttpStatus.OK)
  findAllByDentist(
    @Param('dentistId') dentistId: string,
    @User() actor: UserActor,
  ) {
    return this.referralsService.findAllByDentist(actor, dentistId);
  }
}
