import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Appointment, AppointmentDocument } from './entities/appointment.entity';
import { AppointmentUpsertDto } from './dto/appointment-upsert.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentAvailabilityDto } from './dto/appointment-availability.dto';
import { AppointmentStatus } from '../_shared/enum/appointment-status.enum';
import { clinicReferenceId } from '../users/clinic-membership';
import { AppointmentSchedulingService, OCCUPIED_STATUSES } from './appointment-scheduling.service';
import { calendarDay, ScheduleRequest } from './appointment-scheduling.rules';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectModel(Appointment.name) private readonly appointmentModel: Model<Appointment>,
    private readonly scheduling: AppointmentSchedulingService,
  ) {}

  async create(dto: AppointmentUpsertDto) {
    const request = { ...dto, services: [...new Set(dto.services ?? [])], date: calendarDay(dto.date) };
    const id = await this.scheduling.withLocks([request.dentist, request.patient], async session => {
      const validated = await this.scheduling.validate(request, session);
      const [created] = await this.appointmentModel.create([
        { ...request, ...validated, history: [{ action: 'Appointment created.' }] },
      ], { session });
      return created.id as string;
    });
    return this.findOne(id);
  }

  async availability(dentistId: string): Promise<AppointmentAvailabilityDto[]> {
    if (!Types.ObjectId.isValid(dentistId)) throw new BadRequestException('Invalid dentist ID');
    const appointments = await this.appointmentModel.find({
      dentist: dentistId, status: { $in: OCCUPIED_STATUSES },
    }).select('_id date startTime endTime status').lean().exec();
    return appointments.map(appointment => ({
      _id: appointment._id.toString(), date: appointment.date,
      startTime: appointment.startTime, endTime: appointment.endTime,
      status: appointment.status,
    }));
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
    await this.withExistingSchedule(id, [dto.dentist, dto.patient], async (current, session) => {
      const request = { ...dto, services: [...new Set(dto.services ?? this.scheduleRequest(current).services)], date: calendarDay(dto.date) };
      const validated = await this.scheduling.validate(request, session, id);
      await this.appointmentModel.findByIdAndUpdate(id, {
        $set: { ...request, ...validated },
        $push: { history: { action: 'Appointment details updated.' } },
      }, { session, runValidators: true }).exec();
    });
    return this.findOne(id);
  }

  approve(id: string) {
    return this.updateStatus(id, AppointmentStatus.CONFIRMED, 'Appointment approved.');
  }

  reject(id: string) {
    return this.updateStatus(id, AppointmentStatus.REJECTED, 'Appointment rejected.');
  }

  cancel(id: string, reason?: string) {
    return this.updateStatus(id, AppointmentStatus.CANCELLED, 'Appointment cancelled.', reason);
  }

  async reschedule(id: string, dto: RescheduleAppointmentDto) {
    await this.withExistingSchedule(id, [], async (current, session) => {
      const request = {
        ...this.scheduleRequest(current), date: calendarDay(dto.date),
        startTime: dto.startTime, endTime: dto.endTime,
      };
      await this.scheduling.validate(request, session, id);
      await this.appointmentModel.findByIdAndUpdate(id, {
        $set: { date: request.date, startTime: request.startTime, endTime: request.endTime, status: AppointmentStatus.PENDING },
        $push: { history: { action: 'Appointment rescheduled.', reason: dto.reason?.trim() } },
      }, { session, runValidators: true }).exec();
    });
    return this.findOne(id);
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
    if (!updatedAppointment) {
      throw new NotFoundException(`Appointment with ID "${id}" not found.`);
    }

    return updatedAppointment;
  }


  private async updateStatus(id: string, status: AppointmentStatus, historyAction: string, reason?: string) {
    await this.withExistingSchedule(id, [], async (current, session) => {
      if (status === AppointmentStatus.CONFIRMED) {
        await this.scheduling.validate(this.scheduleRequest(current), session, id, [AppointmentStatus.CONFIRMED]);
      }
      await this.appointmentModel.findByIdAndUpdate(id, {
        $set: { status },
        $push: { history: { action: historyAction, reason: reason?.trim() } },
      }, { session, runValidators: true }).exec();
    });
    return this.findOne(id);
  }

  private scheduleRequest(appointment: Appointment): ScheduleRequest {
    const dentist = clinicReferenceId(appointment.dentist);
    const patient = clinicReferenceId(appointment.patient);
    const clinic = clinicReferenceId(appointment.clinic);
    if (!dentist || !patient || !clinic) throw new BadRequestException('Appointment participants are unavailable');
    return {
      dentist, patient, clinic, date: appointment.date,
      startTime: appointment.startTime, endTime: appointment.endTime,
      services: appointment.services.map(service => clinicReferenceId(service)).filter((id): id is string => !!id),
    };
  }

  private async withExistingSchedule<T>(
    id: string,
    proposedUserIds: string[],
    work: (current: AppointmentDocument, session: ClientSession) => Promise<T>,
  ): Promise<T> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid appointment ID');
    const snapshot = await this.appointmentModel.findById(id).exec();
    if (!snapshot) throw new NotFoundException(`Appointment with ID "${id}" not found.`);
    const before = this.scheduleRequest(snapshot);
    return this.scheduling.withLocks([before.dentist, before.patient, ...proposedUserIds], async session => {
      const current = await this.appointmentModel.findById(id).session(session).exec();
      if (!current) throw new NotFoundException(`Appointment with ID "${id}" not found.`);
      const after = this.scheduleRequest(current);
      if (before.dentist !== after.dentist || before.patient !== after.patient) {
        throw new ConflictException('Appointment participants changed. Reload and try again.');
      }
      return work(current, session);
    });
  }
}
