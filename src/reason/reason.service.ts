import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { Reason, ReasonDocument, ReasonUsage } from './entities/reason.entity';
import { ReasonUpsertDto } from './dto/reason-upsert.dto';


@Injectable()
export class ReasonService {
  constructor(
    @InjectModel(Reason.name)
    private reasonModel: Model<ReasonDocument>,
  ) {}

  create(dto: ReasonUpsertDto) {
    return this.reasonModel.create(dto);
  }

  findAll(usage?: ReasonUsage) {
    const filter: any = { isActive: true };

    if (usage) {
      filter.$or = [{ usage }, { usage: ReasonUsage.BOTH }];
    }

    return this.reasonModel
      .find(filter)
      .sort({ sortOrder: 1, label: 1 });
  }

  findOne(id: string) {
    return this.reasonModel.findById(id).exec();
  }

  update(id: string, dto: ReasonUpsertDto) {
    return this.reasonModel.findByIdAndUpdate(id, dto, { new: true });
  }

  toggleActive(id: string) {
    return this.reasonModel.findById(id).then(reason => {
      if (!reason) return null;
      reason.isActive = !reason.isActive;
      return reason.save();
    });
  }
}
