import { Controller, Get, Query } from '@nestjs/common';
import { ReasonService } from './reason.service';
import { ReasonUsage } from './entities/reason.entity';

// Read-only compatibility for codes stored before reasons became free text.
@Controller('reasons')
export class ReasonController {
  constructor(private readonly reasonService: ReasonService) {}

  @Get()
  findAll(@Query('usage') usage?: ReasonUsage) {
    return this.reasonService.findAll(usage);
  }
}
