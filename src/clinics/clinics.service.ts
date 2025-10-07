import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Clinic } from './entities/clinic.entity';
import mongoose, { Model } from 'mongoose';
import { ClinicUpsertDto } from './dto/clinic-upsert.dto';

@Injectable()
export class ClinicsService {
  constructor(
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
  ) {}

  async findAll() {
    return this.clinicModel.find();
  }

  async findOne(id: string) {
    return this.clinicModel.findOne({ _id: id }).populate('dentists');
  }

  async upsert(doc: ClinicUpsertDto, id?: string) {
    const dup = await this.clinicModel.findOne({ name: doc.name });

    if (dup)
      throw new BadRequestException(
        `Clinic name is already taken: "${doc.name}"`,
      );

    return this.clinicModel.findOneAndUpdate(
      { _id: id || new mongoose.Types.ObjectId() },
      {
        $set: doc,
      },
      { upsert: true, new: true },
    );
  }
}
