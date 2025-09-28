import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from './entities/user.entity';
import mongoose, { Model } from 'mongoose';
import { UserUpsertDto } from './dto/user-upsert.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

  findByOneUsername(username: string) {
    return this.userModel.findOne({ username });
  }

  findAll() {
    return `This action returns all users`;
  }

  findOne(id: string) {
    return this.userModel.findOne({ _id: id });
  }

  async upsert(doc: UserUpsertDto, id?: string) {
    const dup = await this.userModel.findOne({ username: doc.username })

    if (dup) throw new BadRequestException(`Username is already taken: "${doc.username}"`)

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
