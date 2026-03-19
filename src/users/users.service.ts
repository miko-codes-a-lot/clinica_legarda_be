import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from './entities/user.entity';
import mongoose, { Model } from 'mongoose';
import { UserUpsertDto } from './dto/user-upsert.dto';
import * as bcrypt from 'bcrypt';
import { UserStatus } from 'src/_shared/enum/user-status.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  findByOneUsername(username: string) {
    return this.userModel
      .findOne({ username })
      .select('+password')
      .populate('clinic');
  }

  findAll(role?: string) {
    return this.userModel.find({
      ...(role && { role }),
    });
  }

  findOne(id: string) {
    return this.userModel.findOne({ _id: id });
  }

  async updateProfilePicture(id: string, fileName: string) {
    const updatedUser = await this.userModel.findByIdAndUpdate(
      id,
      { profilePicture: fileName },
      { new: true, runValidators: true },
    );

    if (!updatedUser) {
      throw new BadRequestException(`User with ID "${id}" not found.`);
    }

    return updatedUser;
  }

  async upsert(doc: UserUpsertDto, id?: string) {
    if (doc.password) {
      doc.password = await bcrypt.hash(doc.password, 10);
    } else {
      delete doc.password; // remove password if it's empty to avoid overwriting
    }

    const dup = await this.userModel.findOne({
      ...(id && { _id: { $ne: id } }),
      username: doc.username,
    });

    if (dup)
      throw new BadRequestException(
        `Username is already taken: "${doc.username}"`,
      );
    return this.userModel.findOneAndUpdate(
      { _id: id || new mongoose.Types.ObjectId() },
      {
        $set: doc,
      },
      { upsert: true, new: true },
    );
  }

  approve(id: string) {
    return this.updateStatus(
      id,
      UserStatus.CONFIRMED,
    );
  }

  updateOtpVerifiedAt(userId: string) {
    return this.userModel.findByIdAndUpdate(
      userId,
      { $set: { otpVerifiedAt: new Date() } },
      { new: true },
    );
  }

  reject(id: string) {
    return this.updateStatus(
      id,
      UserStatus.REJECTED,
    );
  }

  private async updateStatus(
    id: string,
    status: UserStatus,
  ) {

    const currentUser = await this.userModel.findById(id).exec();

    if (!currentUser) {
      throw new NotFoundException(`User with ID "${id}" not found.`);
    }
 
    const updatedUser = await this.userModel
      .findByIdAndUpdate(
        id,
        {
          $set: { status },
        },
        { new: true },
      )
      .populate('clinic')
      .exec();

    if (!updatedUser) {
      throw new NotFoundException(`User with ID "${id}" not found.`);
    }
    return updatedUser;
  }
}
