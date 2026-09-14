import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Clinic } from './entities/clinic.entity';
import mongoose, { Model } from 'mongoose';
import { ClinicUpsertDto } from './dto/clinic-upsert.dto';
import { User } from 'src/users/entities/user.entity';
import { clinicMembershipFilter } from 'src/users/clinic-membership';

@Injectable()
export class ClinicsService {
  constructor(
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async findAll() {
    return this.clinicModel.find();
  }

  async findOne(id: string) {
    const clinic = await this.clinicModel.findOne({ _id: id });
    if (!clinic) return null;
    const dentists = await this.userModel
      .find({ role: 'dentist', ...clinicMembershipFilter(id) })
      .populate('clinic clinics');
    return { ...clinic.toObject(), dentists };
  }

  async upsert(doc: ClinicUpsertDto, id?: string) {
    const dup = await this.clinicModel.findOne({
      name: doc.name,
      ...(id && { _id: { $ne: id } }), // exclude the current doc if updating
    });

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
