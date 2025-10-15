import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Appointment } from './entities/appointment.entity';
import { AppointmentUpsertDto } from './dto/appointment-upsert.dto';
import { AppointmentStatus } from 'src/_shared/enum/appointment-status.enum';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
  ) {}

  async create(dto: AppointmentUpsertDto) {
    const newAppointment = {
      ...dto,
      history: [{ action: 'Appointment created.' }], // add initial history
    };
    const created = await this.appointmentModel.create(newAppointment);
    return this.findOne(created._id.toString());
  }

  findAll(patient?: string) {
    const filter = patient ? { patient } : {};

    return this.appointmentModel
      .find(filter)
      .populate('clinic patient dentist services')
      .exec();
  }

  findAllByDentist(dentist?: string) {
    const filter = dentist ? { dentist } : {};
    return this.appointmentModel
      .find(filter)
      .populate('clinic patient dentist services')
      .exec();
  }

  async findOne(id: string) {
    const appointment = await this.appointmentModel
      .findById(id)
      .populate('clinic patient dentist services')
      .exec();

    if (!appointment) {
      throw new NotFoundException(`Appointment with ID "${id}" not found.`);
    }
    return appointment;
  }

  async update(id: string, dto: AppointmentUpsertDto) {
    const updatePayload = {
      $set: dto,
      $push: { history: { action: 'Appointment details updated.' } }, // Push new history
    };

    const updatedAppointment = await this.appointmentModel
      .findByIdAndUpdate(id, updatePayload, { new: true })
      .populate('clinic patient dentist services')
      .exec();

    if (!updatedAppointment) {
      throw new NotFoundException(`Appointment with ID "${id}" not found.`);
    }
    return updatedAppointment;
  }

  approve(id: string) {
    return this.updateStatus(
      id,
      AppointmentStatus.CONFIRMED,
      'Appointment approved.',
    );
  }

  reject(id: string) {
    return this.updateStatus(
      id,
      AppointmentStatus.REJECTED,
      'Appointment rejected.',
    );
  }

  private async updateStatus(
    id: string,
    status: AppointmentStatus,
    historyAction: string,
  ) {
    const updatedAppointment = await this.appointmentModel
      .findByIdAndUpdate(
        id,
        {
          $set: { status },
          $push: { history: { action: historyAction } },
        },
        { new: true },
      )
      .populate('clinic patient dentist services')
      .exec();

    if (!updatedAppointment) {
      throw new NotFoundException(`Appointment with ID "${id}" not found.`);
    }
    return updatedAppointment;
  }
}
