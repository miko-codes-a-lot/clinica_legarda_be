import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from './entities/user.entity';
import mongoose, { FilterQuery, HydratedDocument, Model } from 'mongoose';
import { UserUpsertDto } from './dto/user-upsert.dto';
import * as bcrypt from 'bcrypt';
import { Clinic } from 'src/clinics/entities/clinic.entity';
import { assignedClinicIds, clinicMembershipFilter, clinicReferenceId } from './clinic-membership';
import { isAdmin, UserActor } from 'src/auth/role-policy';
import { Appointment } from '../appointments/entities/appointment.entity';
import { referenceId, sameId } from '../auth/record-policy';
import {
  DENTIST_DIRECTORY_FIELDS,
  PATIENT_DIRECTORY_FIELDS,
} from './user-projections';
import { UserStatus } from 'src/_shared/enum/user-status.enum';
import { adminClinicIds, adminClinicScope, visibleClinicMemberships } from '../auth/clinic-policy';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<Appointment>,
  ) {}

  findByOneUsername(username: string) {
    return this.userModel.findOne({ username }).populate('clinic clinics');
  }

  findForSignIn(username: string) {
    return this.findByOneUsername(username).select('+password');
  }

  findForResetOtp(emailAddress: string) {
    return this.userModel
      .findOne({ emailAddress })
      .select('+password +resetOtp +resetOtpExpires +resetOtpVerified');
  }

  async findAll(actor: UserActor) {
    if (!isAdmin(actor))
      throw new ForbiddenException(
        'Only administrators may access the user directory.',
      );
    const filter = actor.role === 'admin' ? await this.adminUserFilter(actor) : {};
    const users = await this.userModel.find(filter).populate('clinic clinics');
    return users.map(user => this.visibleUser(user, actor));
  }

  async dentistDirectory(actor: UserActor) {
    if (!actor?.sub) throw new ForbiddenException('Authentication required.');
    const users = await this.userModel
      .find({ role: 'dentist', status: UserStatus.CONFIRMED,
        ...(actor.role === 'admin' ? clinicMembershipFilter(adminClinicIds(actor)) : {}),
      })
      .select(DENTIST_DIRECTORY_FIELDS)
      .populate('clinic clinics');
    return users.map(user => this.visibleUser(user, actor));
  }

  async patientDirectory(actor: UserActor) {
    if (!isAdmin(actor) && actor?.role !== 'dentist')
      throw new ForbiddenException('You cannot access the patient directory.');
    if (actor.role === 'admin') {
      return this.userModel.find({ role: 'user', ...await this.adminPatientFilter(actor) })
        .select(PATIENT_DIRECTORY_FIELDS);
    }
    const patientIds = isAdmin(actor)
      ? undefined
      : await this.appointmentModel.distinct('patient', {
          dentist: referenceId(actor.sub),
        });
    return this.userModel
      .find({ role: 'user', ...(patientIds && { _id: { $in: patientIds } }) })
      .select(PATIENT_DIRECTORY_FIELDS);
  }

  /** Trusted recipient lookup, deliberately unavailable as a directory route. */
  notificationStaffRecipients(clinicId?: string) {
    return this.userModel
      .find({ $or: [
        { role: 'super-admin' },
        ...(clinicId ? [{ role: 'admin', ...clinicMembershipFilter(referenceId(clinicId)) }] : []),
      ] })
      .select('_id role');
  }

  findForAuthentication(id: string) {
    return this.userModel.findById(referenceId(id)).populate('clinic clinics');
  }

  async findOne(id: string, actor: UserActor) {
    const user = await this.userModel
      .findById(referenceId(id))
      .populate('clinic clinics');
    if (!user) throw new NotFoundException('User not found.');
    await this.authorizeProfile(user, actor);
    return this.visibleUser(user, actor);
  }

  async pictureProfile(id: string, actor: UserActor) {
    if (!actor?.sub) throw new ForbiddenException('Authentication required.');
    const user = await this.userModel
      .findById(referenceId(id))
      .select('_id role status profilePicture clinic clinics');
    if (!user) throw new NotFoundException('User not found.');
    if (actor.role === 'admin' || !(user.role === 'dentist' && user.status === UserStatus.CONFIRMED))
      await this.authorizeProfile(user, actor);
    return user;
  }

  private async authorizeProfile(user: User, actor: UserActor) {
    if (actor?.role === 'super-admin' || (actor?.sub && sameId(actor.sub, user._id))) return;
    if (actor?.role === 'admin') {
      const memberships = adminClinicIds(actor);
      if (user.role !== 'super-admin' && assignedClinicIds(user).some(id => memberships.includes(referenceId(id)))) return;
      if (user.role === 'user' && await this.appointmentModel.exists({ patient: user._id, ...adminClinicScope(actor) })) return;
      throw new ForbiddenException('This user is outside your assigned clinics.');
    }
    if (
      actor?.role === 'dentist' &&
      user.role === 'user' &&
      (await this.appointmentModel.exists({
        dentist: referenceId(actor.sub),
        patient: user._id,
      }))
    )
      return;
    throw new ForbiddenException('You cannot access this profile.');
  }

  private async adminPatientFilter(actor: UserActor) {
    const patients = await this.appointmentModel.distinct('patient', adminClinicScope(actor));
    return { $or: [{ _id: { $in: patients } }, clinicMembershipFilter(adminClinicIds(actor))] };
  }

  private async adminUserFilter(actor: UserActor) {
    return { $or: [
      { _id: referenceId(actor.sub) },
      { role: { $in: ['admin', 'dentist'] }, ...clinicMembershipFilter(adminClinicIds(actor)) },
      { role: 'user', ...await this.adminPatientFilter(actor) },
    ] };
  }

  private visibleUser(user: HydratedDocument<User>, actor: UserActor) {
    if (actor.role !== 'admin') return user;
    return visibleClinicMemberships(user.toJSON(), actor);
  }

  async authorizePictureWrite(id: string, actor: UserActor) {
    if (!actor || (!isAdmin(actor) && !sameId(actor.sub, id)))
      throw new ForbiddenException('You cannot change this picture.');
    const existing = await this.userModel.findById(referenceId(id));
    if (!existing) throw new NotFoundException('User not found.');
    if (existing.role === 'super-admin' && actor.role !== 'super-admin')
      throw new ForbiddenException(
        'Only super administrators may manage super administrators.',
      );
    await this.authorizeProfile(existing, actor);
  }

  async updateProfilePicture(id: string, fileName: string, actor: UserActor) {
    await this.authorizePictureWrite(id, actor);
    const updated = await this.userModel.findByIdAndUpdate(
      id,
      { profilePicture: fileName },
      { new: true, runValidators: true },
    );
    if (!updated) throw new NotFoundException('User not found.');
    return this.visibleUser(updated, actor);
  }

  async approveDentist(id: string, actor: UserActor) {
    if (!isAdmin(actor)) {
      throw new ForbiddenException('Only administrators may approve dentists.');
    }
    const userId = referenceId(id);
    if (actor.role === 'admin') {
      const existing = await this.userModel.findById(userId);
      if (!existing) throw new NotFoundException('Dentist not found.');
      await this.authorizeProfile(existing, actor);
    }
    const approved = await this.userModel
      .findOneAndUpdate(
        { _id: userId, role: 'dentist', status: UserStatus.PENDING,
          ...(actor.role === 'admin' ? clinicMembershipFilter(adminClinicIds(actor)) : {}),
        },
        { $set: { status: UserStatus.CONFIRMED } },
        { new: true, runValidators: true },
      )
      .populate('clinic clinics');
    if (approved) return this.visibleUser(approved, actor);

    const existing = await this.userModel.findById(userId);
    if (!existing) throw new NotFoundException('Dentist not found.');
    if (actor.role === 'admin') await this.authorizeProfile(existing, actor);
    if (existing.role !== 'dentist') {
      throw new BadRequestException(
        'Only dentist accounts can be approved here.',
      );
    }
    throw new ConflictException(
      'Only pending dentists can be approved. Refresh the account details.',
    );
  }

  async upsert(doc: UserUpsertDto, id?: string, actor?: UserActor) {
    if (
      !actor ||
      (!id && !isAdmin(actor)) ||
      (id && !isAdmin(actor) && !sameId(actor.sub, id))
    ) {
      throw new ForbiddenException('You cannot manage this user.');
    }
    const existing = id ? await this.userModel.findById(id) : null;
    if (id && !existing) throw new NotFoundException('User not found.');
    if (!existing && doc.role === undefined) throw new BadRequestException('Select a valid user role.');
    if (actor.role === 'admin') {
      if (existing) await this.authorizeProfile(existing, actor);
      else if (!adminClinicIds(actor).length) throw new ForbiddenException('A clinic assignment is required to create users.');
      if (existing && !sameId(actor.sub, existing._id)) {
        const credentialsChanged = !!doc.password || ['username', 'emailAddress', 'mobileNumber']
          .some(field => doc[field] !== undefined && doc[field] !== existing[field]);
        if (credentialsChanged && await this.hasOutsideClinicAccess(existing, actor))
          throw new ForbiddenException('Only super administrators may change another shared account’s sign-in or verification details.');
      }
    }

    const update = this.profileFields(doc);
    const writeCondition: FilterQuery<User> = {};
    if (!isAdmin(actor)) {
      if (!existing) throw new ForbiddenException('You cannot create users.');
      const assigned = assignedClinicIds(existing);
      const requested =
        doc.clinics === undefined
          ? undefined
          : this.normalizeClinicIds(doc.clinics);
      if (
        (doc.role !== undefined && doc.role !== existing.role) ||
        (doc.status !== undefined && doc.status !== existing.status) ||
        (doc.isWalkIn !== undefined && doc.isWalkIn !== (existing.isWalkIn ?? false)) ||
        (doc.clinic !== undefined &&
          referenceId(doc.clinic) !== assigned[0]?.toLowerCase()) ||
        (requested !== undefined &&
          (requested.length !== assigned.length ||
            requested.some((id) => !assigned.includes(id))))
      )
        throw new ForbiddenException(
          'Only administrators may change roles, status or clinic assignments.',
        );
      // Legacy profile forms echo these fields; never write them for self edits.
    } else {
      if (
        actor.role !== 'super-admin' &&
        (doc.role === 'super-admin' || existing?.role === 'super-admin')
      ) {
        throw new ForbiddenException(
          'Only super administrators may manage super administrators.',
        );
      }
      if (doc.role !== undefined) {
        if (!['user', 'dentist', 'admin', 'super-admin'].includes(doc.role))
          throw new BadRequestException('Invalid user role.');
        update.role = doc.role;
      }
      if (doc.status !== undefined) update.status = doc.status;
      const patientRole = doc.role ?? existing?.role;
      const walkIn = doc.isWalkIn ?? existing?.isWalkIn ?? false;
      if (patientRole !== 'user' && (doc.isWalkIn === true || doc.status === UserStatus.WALK_IN)) {
        throw new BadRequestException('Walk-in registration is only available for patients.');
      }
      if (doc.status === UserStatus.WALK_IN && !walkIn) {
        throw new BadRequestException('Walk-in status requires staff walk-in registration.');
      }
      if (patientRole === 'user') {
        update.isWalkIn = walkIn;
        if (walkIn && (!existing || (doc.isWalkIn === true && !existing.isWalkIn && existing.status === UserStatus.PENDING))) {
          update.status = UserStatus.WALK_IN;
        } else if (!walkIn && existing?.status === UserStatus.WALK_IN) {
          update.status = UserStatus.PENDING;
        }
      } else {
        update.isWalkIn = false;
        if (existing?.status === UserStatus.WALK_IN) update.status = UserStatus.PENDING;
      }
      if (
        doc.clinic !== undefined &&
        (typeof doc.clinic !== 'string' ||
          !mongoose.isObjectIdOrHexString(doc.clinic))
      ) {
        throw new BadRequestException('Invalid clinic ID.');
      }
      const clinics =
        doc.clinics !== undefined || doc.clinic !== undefined
          ? this.normalizeClinicIds(
              doc.clinics !== undefined ? doc.clinics : [doc.clinic],
            )
          : undefined;
      const role = doc.role ?? existing?.role;
      const ordinaryAdmin = actor.role !== 'super-admin';
      if (actor.role === 'admin' && existing && role !== existing.role &&
        await this.hasOutsideClinicAccess(existing, actor)) {
        throw new ForbiddenException('Only super administrators may change a shared user’s role.');
      }
      if (ordinaryAdmin && existing) {
        // Prevent a concurrent role change from bypassing the membership policy.
        writeCondition.role = existing.role;
        if (role === 'admin' && existing.role !== 'admin') {
          writeCondition.clinics = existing.clinics ?? { $exists: false };
          writeCondition.clinic = existing.clinic ?? null;
        }
      }
      if (ordinaryAdmin && (role === 'admin' || existing?.role === 'admin')) {
        const assigned = existing ? assignedClinicIds(existing) : [];
        const visible = actor.role === 'admin' ? assigned.filter(clinic => adminClinicIds(actor).includes(referenceId(clinic))) : assigned;
        const sameAssignments = (value: string[]) => clinics?.length === value.length && clinics.every(clinic => value.includes(clinic));
        const changed = clinics !== undefined && !sameAssignments(assigned) && !sameAssignments(visible);
        const newlyAssignedAdmin =
          role === 'admin' &&
          existing?.role !== 'admin' &&
          (clinics ?? assigned).length > 0;
        if (changed || newlyAssignedAdmin) {
          throw new ForbiddenException(
            'Only super administrators may change admin clinic assignments.',
          );
        }
      }
      // Ordinary admin profile forms may echo assignments, but cannot write them.
      if (
        clinics !== undefined &&
        !(ordinaryAdmin && (role === 'admin' || existing?.role === 'admin'))
      ) {
        if (
          clinics.length &&
          (await this.clinicModel.countDocuments({ _id: { $in: clinics } })) !==
            clinics.length
        ) {
          throw new BadRequestException(
            'One or more assigned clinics do not exist.',
          );
        }
        if (actor.role === 'admin' && role === 'dentist') {
          const allowed = adminClinicIds(actor);
          const outside = existing ? assignedClinicIds(existing).filter(clinic => !allowed.includes(referenceId(clinic))) : [];
          if (clinics.some(clinic => !allowed.includes(clinic) && !outside.includes(clinic)))
            throw new ForbiddenException('You cannot assign clinics outside your scope.');
          update.clinics = [...new Set([...clinics.filter(clinic => allowed.includes(clinic)), ...outside])];
          if (existing) {
            writeCondition.clinics = existing.clinics ?? { $exists: false };
            writeCondition.clinic = existing.clinic ?? null;
          }
        } else if (!(actor.role === 'admin' && role === 'user')) {
          update.clinics = clinics;
        }
        if (Array.isArray(update.clinics) && update.clinics.length) update.clinic = update.clinics[0];
      }
      if (actor.role === 'admin' && role === 'user' && !existing) {
        update.clinics = adminClinicIds(actor);
        update.clinic = adminClinicIds(actor)[0];
      }
    }
    if (existing && doc.emailAddress !== undefined && doc.emailAddress === (existing.emailAddress ?? '')) {
      // Profile forms echo contacts. Do not overwrite a newer verified email.
      delete update.emailAddress;
    }
    if (existing && doc.emailAddress !== undefined && doc.emailAddress !== (existing.emailAddress ?? '')) {
      update.otpVerifiedAt = null;
      const role = update.role ?? existing.role;
      if (role === 'user' && (update.status ?? existing.status) === UserStatus.CONFIRMED) {
        update.status = (update.isWalkIn ?? existing.isWalkIn) ? UserStatus.WALK_IN : UserStatus.PENDING;
      }
      // A verification that races a profile write must not restore old proof.
      writeCondition.emailAddress = existing.emailAddress ?? { $exists: false };
      writeCondition.status = existing.status;
      writeCondition.role = existing.role;
    }
    const saved = await this.persist(update, id, writeCondition);
    return saved ? this.visibleUser(saved, actor) : saved;
  }

  private async hasOutsideClinicAccess(user: User, actor: UserActor) {
    const clinics = adminClinicIds(actor);
    return assignedClinicIds(user).some(clinic => !clinics.includes(referenceId(clinic))) ||
      !!await this.appointmentModel.exists({ $or: [{ patient: user._id }, { dentist: user._id }], clinic: { $nin: clinics } });
  }

  /** Public registration has an explicit, nonprivileged write path. */
  registerPatient(doc: UserUpsertDto) {
    if (doc.isWalkIn || doc.status === UserStatus.WALK_IN) {
      throw new ForbiddenException('Only clinic administrators may register walk-in patients.');
    }
    return this.persist({
      ...this.profileFields(doc),
      role: 'user',
      status: UserStatus.PENDING,
      clinics: [],
    });
  }

  private profileFields(doc: UserUpsertDto): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const fields = [
      'firstName',
      'middleName',
      'lastName',
      'username',
      'password',
      'emailAddress',
      'mobileNumber',
      'address',
      'operatingHours',
    ] as const;
    for (const field of fields)
      if (doc[field] !== undefined) result[field] = doc[field];
    return result;
  }

  private normalizeClinicIds(value: unknown): string[] {
    if (
      !Array.isArray(value) ||
      value.some(
        (id) => typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id),
      )
    ) {
      throw new BadRequestException(
        'Clinic assignments must contain valid clinic IDs.',
      );
    }
    return [...new Set((value as string[]).map((id) => id.toLowerCase()))];
  }

  private async persist(
    doc: Record<string, unknown>,
    id?: string,
    writeCondition: FilterQuery<User> = {},
  ) {
    if (typeof doc.password === 'string' && doc.password) {
      doc.password = await bcrypt.hash(doc.password, 10);
    } else {
      delete doc.password;
    }

    const uniqueFields = ['username', 'emailAddress', 'mobileNumber'].filter(field => typeof doc[field] === 'string' && !!doc[field]);
    const dup = uniqueFields.length ? await this.userModel.findOne({
      ...(id && { _id: { $ne: id } }),
      $or: uniqueFields.map(field => ({ [field]: doc[field] })),
    }) : null;
    if (dup) {
      if (doc.username && dup.username === doc.username) {
        throw new BadRequestException(
          `Username is already taken: "${doc.username}"`,
        );
      }

      if (doc.emailAddress && dup.emailAddress === doc.emailAddress) {
        throw new BadRequestException(
          `Email address already exists: "${doc.emailAddress}"`,
        );
      }

      if (doc.mobileNumber && dup.mobileNumber === doc.mobileNumber) {
        throw new BadRequestException(
          `Mobile number already exists: "${doc.mobileNumber}"`,
        );
      }
    }

    const unset: Record<string, number> = {};
    for (const field of ['emailAddress', 'mobileNumber', 'otpVerifiedAt']) {
      if (doc[field] === '' || doc[field] === null) { unset[field] = 1; delete doc[field]; }
    }
    if (Array.isArray(doc.clinics) && doc.clinics.length === 0) unset.clinic = 1;
    const saved = await this.userModel
      .findOneAndUpdate(
        { _id: id || new mongoose.Types.ObjectId(), ...writeCondition },
        {
          $set: doc,
          ...(Object.keys(unset).length && { $unset: unset }),
        },
        { upsert: !id, new: true, runValidators: true },
      )
      .populate('clinic clinics');
    if (!saved && Object.keys(writeCondition).length > 0) {
      throw new ConflictException(
        'User assignments or role changed. Refresh and try again.',
      );
    }
    return saved;
  }

  async delete(id: string, actor: UserActor) {
    if (!isAdmin(actor))
      throw new ForbiddenException('Only administrators may delete users.');
    referenceId(id);
    const user = await this.userModel.findById(id);

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found.`);
    }
    await this.authorizeProfile(user, actor);
    if (actor.role === 'admin' && await this.hasOutsideClinicAccess(user, actor))
      throw new ForbiddenException('Only super administrators may delete users shared with other clinics.');

    // Optional protection
    // Prevent deleting main admins
    if (user.role === 'super-admin') {
      throw new BadRequestException('Super admin accounts cannot be deleted.');
    }

    await this.userModel.findByIdAndDelete(id);

    return {
      message: 'User deleted successfully.',
    };
  }

  async completeEmailVerification(user: User) {
    const status = user.role === 'user' && [UserStatus.PENDING, UserStatus.WALK_IN].includes(user.status)
      ? UserStatus.CONFIRMED : user.status;
    const verified = await this.userModel.findOneAndUpdate(
      { _id: user._id, emailAddress: user.emailAddress, role: user.role, status: user.status },
      { $set: { otpVerifiedAt: new Date(), status } },
      { new: true },
    ).populate('clinic clinics');
    if (!verified) throw new ConflictException('Account details changed. Sign in again to verify your current email.');
    return verified;
  }
}
