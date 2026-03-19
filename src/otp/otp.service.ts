import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Otp } from './entities/otp.entity';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class OtpService {
  constructor(
    @InjectModel(Otp.name) private readonly otpModel: Model<Otp>,
  ) {}

  async generate(userId: string): Promise<string> {
    await this.otpModel.deleteMany({ user: userId });

    const code = crypto.randomInt(100000, 999999).toString();
    const hashedCode = await bcrypt.hash(code, 10);

    await this.otpModel.create({
      user: userId,
      code: hashedCode,
    });

    return code;
  }

  async verify(userId: string, code: string): Promise<boolean> {
    const otpRecord = await this.otpModel.findOne({ user: userId });

    if (!otpRecord) {
      throw new BadRequestException('OTP has expired or does not exist');
    }

    const isValid = await bcrypt.compare(code, otpRecord.code);

    if (!isValid) {
      throw new BadRequestException('Invalid OTP code');
    }

    return true;
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.otpModel.deleteMany({ user: userId });
  }
}
