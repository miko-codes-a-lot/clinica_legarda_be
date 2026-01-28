import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Put,
  Patch
} from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralUpsertDto } from './dto/referral-upsert.dto';

@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @HttpCode(HttpStatus.OK)
  @Get()
  findAll() {
    return this.referralsService.findAll();
  }

  @HttpCode(HttpStatus.OK)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.referralsService.findOne(id);
  }

  @HttpCode(HttpStatus.CREATED)
  @Post()
  create(@Body() doc: ReferralUpsertDto) {
    return this.referralsService.upsert(doc);
  }

  @HttpCode(HttpStatus.OK)
  @Put(':id')
  update(@Param('id') id: string, @Body() doc: ReferralUpsertDto) {
    return this.referralsService.upsert(doc, id);
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string) {
    return this.referralsService.approve(id);
  }

  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id') id: string, @Body('reasonOfDecline') reasonOfDecline: string) {
    return this.referralsService.reject(reasonOfDecline, id);
  }

  @Get('by-dentist/:dentistId')
  @HttpCode(HttpStatus.OK)
  findAllByDentist(@Param('dentistId') dentistId?: string) {
    return this.referralsService.findAllByDentist(dentistId);
  }
}
