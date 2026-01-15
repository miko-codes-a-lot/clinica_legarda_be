import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Appointment } from './entities/appointment.entity';
import { User } from '../users/entities/user.entity';

import { DentalCatalog } from '../dental-catalog/entities/dental-catalog.entity';

import { AppointmentUpsertDto } from './dto/appointment-upsert.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentStatus } from 'src/_shared/enum/appointment-status.enum';
import * as dayjs from 'dayjs';
import { diffMinutes } from '../_shared/time.util';


@Injectable()
export class AppointmentsService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,

    @InjectModel(User.name)
    private userModel: Model<User>,

    @InjectModel(DentalCatalog.name)
    private serviceModel: Model<DentalCatalog>,
  ) {}

  async create(dto: AppointmentUpsertDto) {
    const dentist = await this.userModel.findById(dto.dentist);

    if (!dentist || dentist.role !== 'dentist') {
      throw new BadRequestException('Invalid dentist selected');
    }

    // Validate operating hours
    this.validateOperatingHours(
      dentist,
      dto.date,
      dto.startTime,
      dto.endTime,
    );

    // Validate overlapping time ranges
    await this.validateOverlap(
      dto.dentist,
      dto.date,
      dto.startTime,
      dto.endTime,
    );

    // Validate daily capacity (NOT a tight limit)
    await this.validateDailyCapacity(
      dentist,
      dto.date,
      dto.startTime,
      dto.endTime,
      dto.services || [],
    );

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
      .populate('clinic patient dentist services referral')
      .populate({
        path: 'referral.fromClinicId', // populate the referral's source clinic
        model: 'clinic'
      })
      .exec();
  }

  findAllByDentist(dentist?: string) {
    const filter = dentist ? { dentist } : {};
    return this.appointmentModel
      .find(filter)
      .populate('clinic patient dentist services referral')
      .exec();
  }

  async findOne(id: string) {
    const appointment = await this.appointmentModel
      .findById(id)
      .populate('clinic patient dentist services referral')
      .populate({
        path: 'referral', // the field in appointment
        populate: [
          { path: 'fromClinicId' },  // populate referral.fromClinicId
          { path: 'fromDoctorId' }   // populate referral.fromDoctorId
        ]
      })
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

    const currentAppointment = await this.appointmentModel.findById(id).exec();

    if (!currentAppointment) {
      throw new NotFoundException(`Appointment with ID "${id}" not found.`);
    }

    // 🔴 DUPLICATE CHECK
    const duplicate = await this.appointmentModel.findOne({
      _id: { $ne: id }, // exclude current appointment
      dentist: currentAppointment.dentist,
      date: currentAppointment.date,
      startTime: currentAppointment.startTime,
      endTime: currentAppointment.endTime,
      status: AppointmentStatus.CONFIRMED,
      // status: { $ne: AppointmentStatus.CANCELLED }, // optional safeguard
    });

    if (duplicate) {
      throw new BadRequestException(
        'You have an existing Appointment on the given date and time',
      );
    }
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

  // functions for limitation
  private validateOperatingHours(
    dentist: User,
    date: Date,
    startTime: string,
    endTime: string,
  ) {
    const day = dayjs(date).format('dddd').toLowerCase();
    if (dentist.operatingHours) {
      const schedule = dentist.operatingHours.find(d => d.day === day);
      if (!schedule) {
        throw new BadRequestException('Dentist is not available on this day');
      }

      if (
        startTime < schedule.startTime ||
        endTime > schedule.endTime
      ) {
        throw new BadRequestException(
          'Appointment is outside dentist operating hours',
        );
      }
    }
  }

  private async validateOverlap(
    dentistId: string,
    date: Date,
    startTime: string,
    endTime: string,
  ) {
    const overlap = await this.appointmentModel.countDocuments({
      dentist: dentistId,
      date,
      status: { $in: ['pending', 'confirmed'] },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    });

    if (overlap > 0) {
      throw new BadRequestException(
        'Dentist already has an appointment during this time',
      );
    }
  }

  private async validateDailyCapacity(
    dentist: User,
    date: Date,
    startTime: string,
    endTime: string,
    serviceIds: string[],
  ) {
    const services = await this.serviceModel.find({
      _id: { $in: serviceIds },
    });

    const serviceMinutes = services.reduce(
      (sum, s) => sum + s.duration,
      0,
    );

    const appointmentCost =
      serviceMinutes + dentist.appointmentBufferMinutes;

    const appointments = await this.appointmentModel.find({
      dentist: dentist._id,
      date,
      status: { $in: ['pending', 'confirmed'] },
    });

    const usedMinutes = appointments.reduce((sum, a) => {
      return sum + diffMinutes(date, a.startTime, a.endTime);
    }, 0);

    if (usedMinutes + appointmentCost > dentist.maxWorkingMinutesPerDay) {
      throw new BadRequestException(
        'Dentist has no remaining working time for this day',
      );
    }
  }


}
