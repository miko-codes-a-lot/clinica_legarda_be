import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Referral } from './entities/referral.entity';
import mongoose, { Model } from 'mongoose';
import { ReferralUpsertDto } from './dto/referral-upsert.dto';
import { Appointment } from 'src/appointments/entities/appointment.entity'; // import Appointment entity
import { ReferralStatus } from 'src/_shared/enum/referral-status.enum';

@Injectable()
export class ReferralsService {
  constructor(
    @InjectModel(Referral.name)
    private readonly referralModel: Model<Referral>,

    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
  ) {}

  async findAll() {
    return this.referralModel.find();
  }

  async findOne(id: string) {
    // 1. Find the referral
    const referral = await this.referralModel
      .findOne({ _id: id })
      .populate('fromDoctorId fromClinicId') // still populate doctor/clinic
      .exec();

    if (!referral) return null;

    // 2. Find the linked appointment (if any)
    const appointment = await this.appointmentModel.findOne({ referral: referral._id }).populate('clinic dentist services').exec();

    // 3. Return referral with the linked appointment as a new property
    return {
      ...referral.toObject(),
      appointment, // will be null if no appointment linked
    };
  }
  
  findAllByDentist(dentist?: string) {
    const filter = dentist ? { fromDoctorId: dentist } : {};
    return this.referralModel
      .find(filter)
      .populate('fromDoctorId fromClinicId')
      .exec();
  }

  async upsert(doc: ReferralUpsertDto, id?: string) {
    // const dup = await this.referralModel.findOne({
    //   ...(id && { _id: { $ne: id } }), // exclude the current doc if updating
    // });

    // if (dup)
    //   throw new BadRequestException(
    //     `Referral already exists`,
    //   );

    return this.referralModel.findOneAndUpdate(
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
      ReferralStatus.CONFIRMED,
      // 'Referral approved.',
    );
  }

  reject(id: string) {
    return this.updateStatus(
      id,
      ReferralStatus.REJECTED,
      // 'Referral rejected.',
    );
  }

  private async updateStatus(
    id: string,
    status: ReferralStatus,
    // historyAction: string,
  ) {

    const currentReferral = await this.referralModel.findById(id).exec();

    if (!currentReferral) {
      throw new NotFoundException(`Referral with ID "${id}" not found.`);
    }

    const updatedReferral = await this.referralModel
      .findByIdAndUpdate(
        id,
        {
          $set: { status },
        },
        { new: true },
      )
      .populate('fromDoctorId fromClinicId appointment')
      .exec();

    if (!updatedReferral) {
      throw new NotFoundException(`Appointment with ID "${id}" not found.`);
    }
    return updatedReferral;
  }
  
}
