import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from './entities/user.entity';
import mongoose, { Model } from 'mongoose';
import { UserUpsertDto } from './dto/user-upsert.dto';
import * as bcrypt from 'bcrypt';

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

  findForResetOtp(emailAddress: string) {
    return this.userModel
      .findOne({ emailAddress })
      .select('+password +resetOtp +resetOtpExpires +resetOtpVerified');
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
      $or: [
        { username: doc.username },
        { emailAddress: doc.emailAddress },
        { mobileNumber: doc.mobileNumber },
      ]
    });
    if (dup) {
      if (dup.username === doc.username) {
        throw new BadRequestException(
          `Username is already taken: "${doc.username}"`,
        );
      }

      if (dup.emailAddress === doc.emailAddress) {
        throw new BadRequestException(
          `Email address already exists: "${doc.emailAddress}"`,
        );
      }

      if (dup.mobileNumber === doc.mobileNumber) {
        throw new BadRequestException(
          `Mobile number already exists: "${doc.mobileNumber}"`,
        );
      }
    }

    return this.userModel.findOneAndUpdate(
      { _id: id || new mongoose.Types.ObjectId() },
      {
        $set: doc,
      },
      { upsert: true, new: true },
    );
  }


  updateOtpVerifiedAt(userId: string) {
    return this.userModel.findByIdAndUpdate(
      userId,
      { $set: { otpVerifiedAt: new Date() } },
      { new: true },
    );
  }
}
