import { BadRequestException, Injectable } from '@nestjs/common';
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
    return this.userModel.findOne({ username }).select('+password');
  }

  findAll() {
    return this.userModel.find();
  }

  findOne(id: string) {
    return this.userModel.findOne({ _id: id });
  }

  async upsert(doc: UserUpsertDto, id?: string) {
    const dup = await this.userModel.findOne({ username: doc.username });

    if (doc.password) {
      doc.password = await bcrypt.hash(doc.password, 10);
    }

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

  remove(id: string) {
    return `This action removes a #${id} user`;
  }
}
