import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Reason, ReasonDocument, ReasonUsage } from './entities/reason.entity';

@Injectable()
export class ReasonService {
  constructor(
    @InjectModel(Reason.name)
    private reasonModel: Model<ReasonDocument>,
  ) {}

  findAll(usage?: ReasonUsage) {
    // Inactive entries may still label historical referrals and appointments.
    const filter: FilterQuery<Reason> = {};

    if (usage) {
      filter.$or = [{ usage }, { usage: ReasonUsage.BOTH }];
    }

    return this.reasonModel
      .find(filter)
      .sort({ sortOrder: 1, label: 1 });
  }
}
