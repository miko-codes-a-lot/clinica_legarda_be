import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Referral } from './entities/referral.entity';
import { ReferralUpsertDto } from './dto/referral-upsert.dto';
import { Appointment } from '../appointments/entities/appointment.entity';
import { ReferralStatus } from '../_shared/enum/referral-status.enum';
import { AppointmentsService } from '../appointments/appointments.service';
import { isAdmin, UserActor } from '../auth/role-policy';
import { referenceId, sameId } from '../auth/record-policy';
import { APPOINTMENT_PERSON_FIELDS } from '../users/user-projections';
import { adminClinicIds, adminClinicScope, assertClinicAccess, canAccessClinic } from '../auth/clinic-policy';

@Injectable()
export class ReferralsService {
  constructor(
    @InjectModel(Referral.name) private readonly referralModel: Model<Referral>,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
    private readonly appointmentService: AppointmentsService,
  ) {}

  async findAll(actor: UserActor, dentist?: string) {
    const filter = await this.scope(actor);
    const dentistFilter = dentist
      ? {
          $or: [
            { fromDoctorId: referenceId(dentist) },
            {
              _id: {
                $in: await this.appointmentModel.distinct('referral', {
                  dentist: referenceId(dentist),
                }),
              },
            },
          ],
        }
      : {};
    const records = await this.referralModel
      .find({ $and: [filter, dentistFilter] })
      .select('_id')
      .exec();
    return Promise.all(records.map((record) => this.findOne(record.id, actor)));
  }

  findAllByDentist(actor: UserActor, dentist: string) {
    return this.findAll(actor, dentist);
  }

  private async scope(actor: UserActor) {
    if (actor?.role === 'super-admin') return {};
    if (actor?.role === 'admin') return { $or: [
      { fromClinicId: { $in: adminClinicIds(actor) } },
      { _id: { $in: await this.appointmentModel.distinct('referral', adminClinicScope(actor)) } },
    ] };
    if (actor?.role !== 'dentist' && actor?.role !== 'user')
      throw new ForbiddenException('You cannot access referrals.');
    const linked = await this.appointmentModel.distinct('referral', {
      [actor.role === 'dentist' ? 'dentist' : 'patient']: referenceId(
        actor.sub,
      ),
    });
    return {
      $or: [
        { _id: { $in: linked } },
        {
          [actor.role === 'dentist' ? 'fromDoctorId' : 'patient']: referenceId(
            actor.sub,
          ),
        },
      ],
    };
  }

  private async authorized(id: string, actor: UserActor, decision = false) {
    const referral = await this.referralModel.findById(referenceId(id)).exec();
    if (!referral) throw new NotFoundException('Referral not found.');
    const appointment = await this.appointmentModel
      .findOne({ referral: referral._id })
      .exec();
    if (actor?.role === 'super-admin') return { referral, appointment };
    if (actor?.role === 'admin') {
      const source = canAccessClinic(actor, referral.fromClinicId);
      const receiving = appointment && canAccessClinic(actor, appointment.clinic);
      if ((source || receiving) && (!decision || !appointment || receiving)) return { referral, appointment };
      throw new ForbiddenException('This referral is outside your assigned clinics.');
    }
    if (
      actor?.role === 'dentist' &&
      (sameId(actor.sub, referral.fromDoctorId) ||
        (appointment && sameId(actor.sub, appointment.dentist)))
    )
      return { referral, appointment };
    // The receiving record is authoritative for legacy referrals and linked ownership.
    const patient = appointment?.patient ?? referral.patient;
    if (
      !decision &&
      actor?.role === 'user' &&
      patient &&
      sameId(actor.sub, patient)
    )
      return { referral, appointment };
    throw new ForbiddenException('You cannot access this referral.');
  }

  async findOne(id: string, actor: UserActor) {
    const { referral, appointment } = await this.authorized(id, actor);
    await referral.populate([
      { path: 'fromDoctorId', select: APPOINTMENT_PERSON_FIELDS },
      { path: 'fromClinicId' },
    ]);
    // A source dentist can see receiving booking context, not the receiving clinician's chart/history.
    const linked = appointment && (actor.role !== 'admin' || canAccessClinic(actor, appointment.clinic))
      ? await this.appointmentModel
          .findById(appointment._id)
          .select(
            '_id clinic dentist patient services date startTime endTime status notes.patientNotes',
          )
          .populate([
            { path: 'clinic services' },
            { path: 'dentist patient', select: APPOINTMENT_PERSON_FIELDS },
          ])
          .exec()
      : null;
    return {
      _id: referral._id,
      fromDoctorId: referral.fromDoctorId,
      fromClinicId: referral.fromClinicId,
      reason: referral.reason,
      reasonOfDecline: referral.reasonOfDecline,
      status: referral.status,
      createdAt: referral.createdAt,
      updatedAt: referral.updatedAt,
      appointment: linked,
    };
  }

  async upsert(
    doc: ReferralUpsertDto,
    id: string | undefined,
    actor: UserActor,
  ) {
    if (id) {
      const { referral, appointment } = await this.authorized(id, actor);
      const patient = appointment?.patient ?? referral.patient;
      if (
        !sameId(doc.fromDoctorId, referral.fromDoctorId) ||
        !sameId(doc.fromClinicId, referral.fromClinicId) ||
        (doc.patient && (!patient || !sameId(doc.patient, patient)))
      )
        throw new ForbiddenException('Referral identities cannot be changed.');
      await this.referralModel
        .findByIdAndUpdate(
          id,
          { $set: { reason: doc.reason } },
          { runValidators: true },
        )
        .exec();
      return this.findOne(id, actor);
    }
    const patient =
      actor?.role === 'user'
        ? referenceId(actor.sub)
        : doc.patient
          ? referenceId(doc.patient)
          : undefined;
    if (!patient)
      throw new BadRequestException('Select a patient for this referral.');
    if (!isAdmin(actor) && actor?.role !== 'user' && actor?.role !== 'dentist')
      throw new ForbiddenException('You cannot create referrals.');
    const sourceDentist = referenceId(doc.fromDoctorId);
    const sourceClinic = referenceId(doc.fromClinicId);
    assertClinicAccess(actor, sourceClinic);
    if (actor.role === 'dentist' && !sameId(sourceDentist, actor.sub))
      throw new ForbiddenException(
        'Dentists may only send their own referrals.',
      );
    if (
      !(await this.appointmentModel.exists({
        patient,
        dentist: sourceDentist,
        clinic: sourceClinic,
      }))
    )
      throw new ForbiddenException(
        'Referring dentist and clinic must match the patient’s appointment history.',
      );
    const referral = await this.referralModel.create({
      patient,
      createdBy: referenceId(actor.sub),
      fromDoctorId: sourceDentist,
      fromClinicId: sourceClinic,
      reason: doc.reason,
      status: ReferralStatus.PENDING,
    });
    return this.findOne(referral.id, actor);
  }

  async approve(id: string, actor: UserActor) {
    await this.authorized(id, actor, true);
    await this.referralModel
      .findByIdAndUpdate(
        id,
        { $set: { status: ReferralStatus.CONFIRMED } },
        { runValidators: true },
      )
      .exec();
    return this.findOne(id, actor);
  }

  async reject(reasonOfDecline: string, id: string, actor: UserActor) {
    await this.authorized(id, actor, true);
    if (typeof reasonOfDecline !== 'string')
      throw new BadRequestException('Decline reason must be text.');
    await this.appointmentService.rejectLinkedReferral(
      id,
      actor,
      reasonOfDecline,
    );
    return this.findOne(id, actor);
  }
}
