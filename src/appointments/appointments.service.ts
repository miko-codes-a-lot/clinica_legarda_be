import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Appointment } from './entities/appointment.entity';
import { AppointmentUpsertDto } from './dto/appointment-upsert.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentStatus } from 'src/_shared/enum/appointment-status.enum';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
  ) {}

  async create(dto: AppointmentUpsertDto) {
    // Check for overlapping appointments
    const overlappingPatient = await this.appointmentModel.findOne({
      patient: dto.patient,
      date: dto.date,
      startTime: dto.startTime,
      status: { $in: ['pending', 'confirmed'] }
    }).populate('patient');

    if (overlappingPatient) {
      throw new BadRequestException(
        `${overlappingPatient.patient.firstName} ${overlappingPatient.patient.lastName} already have an appointment at this time. Please choose a different slot.`
      );
    }

    // Check if dentist already has a confirmed appointment at that time
    const overlappingDentist = await this.appointmentModel.findOne({
      dentist: dto.dentist,
      date: dto.date,
      startTime: dto.startTime,
      status: AppointmentStatus.CONFIRMED // only confirmed blocks
    });

    if (overlappingDentist) {
      throw new BadRequestException(
        'The selected dentist already has a confirmed appointment at this time. Please choose a different slot.'
      );
    }


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

  cancel(id: string) {
    return this.updateStatus(
      id,
      AppointmentStatus.CANCELLED,
      'Appointment cancelled.',
    );
  }

  async reschedule(id: string, dto: RescheduleAppointmentDto) {

    // Check for overlapping appointments
    const overlappingPatient = await this.appointmentModel.findOne({
      patient: dto.patient,
      date: dto.date,
      startTime: dto.startTime,
      status: { $in: ['pending', 'confirmed'] }
    }).populate('patient');

    if (overlappingPatient) {
      throw new BadRequestException(
        `${overlappingPatient.patient.firstName} ${overlappingPatient.patient.lastName} already have an appointment at this time. Please choose a different slot.`
      );
    }

    // Check if dentist already has a confirmed appointment at that time
    const overlappingDentist = await this.appointmentModel.findOne({
      dentist: dto.dentist,
      date: dto.date,
      startTime: dto.startTime,
      status: AppointmentStatus.CONFIRMED // only confirmed blocks
    });

    if (overlappingDentist) {
      throw new BadRequestException(
        'The selected dentist already has a confirmed appointment at this time. Please choose a different slot.'
      );
    }

    const updatePayload = {
      $set: {
        date: dto.date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        status: AppointmentStatus.PENDING, // return to pending until clinic re-approves
      },
      $push: { history: { action: 'Appointment rescheduled by patient.' } },
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

  async updateDentistNotes(
    id: string,
    dentistNotes: string
  ) {
    const updatedAppointment = await this.appointmentModel
      .findByIdAndUpdate(
        id,
        { 
          $set: { 'notes.clinicNotes': dentistNotes },
          $push: { history: { action: 'Dentist added notes.' } }
        },
        { new: true }
      )
      .populate('clinic patient dentist services')
      .exec();
    // console.log('updatedAppointment', updatedAppointment)
    if (!updatedAppointment) {
      throw new NotFoundException(`Appointment with ID "${id}" not found.`);
    }

    return updatedAppointment;
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
