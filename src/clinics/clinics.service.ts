import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Clinic } from './entities/clinic.entity';
import mongoose, { Model } from 'mongoose';
import { ClinicUpsertDto } from './dto/clinic-upsert.dto';
import { User } from 'src/users/entities/user.entity';
import { clinicMembershipFilter } from 'src/users/clinic-membership';
import { UserActor } from '../auth/role-policy';

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
    this.validateId(id);
    const clinic = await this.clinicModel.findOne({ _id: id });
    if (!clinic) throw new NotFoundException('Clinic not found.');
    const dentists = await this.userModel
      .find({ role: 'dentist', ...clinicMembershipFilter(id) })
      .populate('clinic clinics');
    return { ...clinic.toObject(), dentists };
  }

  async upsert(doc: ClinicUpsertDto, id?: string, actor?: UserActor) {
    if (actor?.role !== 'super-admin') {
      throw new ForbiddenException(
        'Only super administrators may manage clinics.',
      );
    }
    if (id) {
      this.validateId(id);
      if (!(await this.clinicModel.findById(id))) {
        throw new NotFoundException('Clinic not found.');
      }
    }
    const name = doc.name.trim();
    const nameKey = name.toLowerCase();
    const duplicate = await this.clinicModel.findOne({
      $or: [
        { nameKey },
        {
          nameKey: { $exists: false },
          $expr: {
            $eq: [
              { $toLower: { $trim: { input: { $ifNull: ['$name', ''] } } } },
              nameKey,
            ],
          },
        },
      ],
      ...(id && { _id: { $ne: id } }),
    });
    if (duplicate)
      throw new BadRequestException(`Clinic name is already taken: "${name}"`);

    try {
      const updated = await this.clinicModel.findOneAndUpdate(
        { _id: id || new mongoose.Types.ObjectId() },
        {
          $set: {
            name,
            nameKey,
            address: doc.address,
            mobileNumber: doc.mobileNumber,
            emailAddress: doc.emailAddress,
            ...(doc.operatingHours !== undefined && {
              operatingHours: doc.operatingHours,
            }),
          },
        },
        { upsert: !id, new: true, runValidators: true },
      );
      if (!updated) throw new NotFoundException('Clinic not found.');
      return updated;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new BadRequestException(
          `Clinic name is already taken: "${name}"`,
        );
      }
      throw error;
    }
  }

  private validateId(id: string): void {
    if (!mongoose.isObjectIdOrHexString(id))
      throw new BadRequestException('Invalid clinic ID.');
  }
}
