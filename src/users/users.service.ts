import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from './entities/user.entity';
import mongoose, { Model } from 'mongoose';
import { UserUpsertDto } from './dto/user-upsert.dto';
import * as bcrypt from 'bcrypt';
import { Clinic } from 'src/clinics/entities/clinic.entity';
import { assignedClinicIds, clinicReferenceId } from './clinic-membership';
import { isAdmin, UserActor } from 'src/auth/role-policy';
import { UserStatus } from 'src/_shared/enum/user-status.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
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

  findAll(role?: string) {
    return this.userModel
      .find({
        ...(role && { role }),
      })
      .populate('clinic clinics');
  }

  findOne(id: string) {
    return this.userModel.findOne({ _id: id }).populate('clinic clinics');
  }

  async updateProfilePicture(id: string, fileName: string) {
    const updatedUser = await this.userModel.findByIdAndUpdate(
      id,
      { profilePicture: fileName },
      { new: true, runValidators: true },
    );

    if (!updatedUser) {
      throw new BadRequestException(`User with ID "${id}" not found.`);
    }

    return updatedUser;
  }

  async upsert(doc: UserUpsertDto, id?: string, actor?: UserActor) {
    if (
      !actor ||
      (!id && !isAdmin(actor)) ||
      (id && !isAdmin(actor) && actor.sub !== id)
    ) {
      throw new ForbiddenException('You cannot manage this user.');
    }
    const existing = id ? await this.userModel.findById(id) : null;
    if (id && !existing) throw new NotFoundException('User not found.');

    const update = this.profileFields(doc);
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
        (doc.clinic !== undefined &&
          clinicReferenceId(doc.clinic) !== assigned[0]) ||
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
      if (
        doc.clinic !== undefined &&
        (typeof doc.clinic !== 'string' ||
          !mongoose.isObjectIdOrHexString(doc.clinic))
      ) {
        throw new BadRequestException('Invalid clinic ID.');
      }
      if (doc.clinics !== undefined || doc.clinic !== undefined) {
        const clinics = this.normalizeClinicIds(
          doc.clinics !== undefined ? doc.clinics : [doc.clinic],
        );
        if (
          clinics.length &&
          (await this.clinicModel.countDocuments({ _id: { $in: clinics } })) !==
            clinics.length
        ) {
          throw new BadRequestException(
            'One or more assigned clinics do not exist.',
          );
        }
        update.clinics = clinics;
        if (clinics.length) update.clinic = clinics[0];
      }
    }
    return this.persist(update, id);
  }

  /** Public registration has an explicit, nonprivileged write path. */
  registerPatient(doc: UserUpsertDto) {
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

  private async persist(doc: Record<string, unknown>, id?: string) {
    if (typeof doc.password === 'string' && doc.password) {
      doc.password = await bcrypt.hash(doc.password, 10);
    } else {
      delete doc.password;
    }

    const dup = await this.userModel.findOne({
      ...(id && { _id: { $ne: id } }),
      $or: [
        { username: doc.username },
        { emailAddress: doc.emailAddress },
        { mobileNumber: doc.mobileNumber },
      ],
    });
    if (dup) {
      if (dup.username === doc.username) {
        throw new BadRequestException(
          `Username is already taken: "${doc.username}"`,
        );
      }

      if (dup.emailAddress === doc.emailAddress) {
        throw new BadRequestException(
          `Email address already exists: "${doc.emailAddress}"`,
        );
      }

      if (dup.mobileNumber === doc.mobileNumber) {
        throw new BadRequestException(
          `Mobile number already exists: "${doc.mobileNumber}"`,
        );
      }
    }

    return this.userModel
      .findOneAndUpdate(
        { _id: id || new mongoose.Types.ObjectId() },
        {
          $set: doc,
          ...(Array.isArray(doc.clinics) &&
            doc.clinics.length === 0 && { $unset: { clinic: 1 } }),
        },
        { upsert: !id, new: true, runValidators: true },
      )
      .populate('clinic clinics');
  }

  async delete(id: string) {
    const user = await this.userModel.findById(id);

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found.`);
    }

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

  updateOtpVerifiedAt(userId: string) {
    return this.userModel.findByIdAndUpdate(
      userId,
      { $set: { otpVerifiedAt: new Date() } },
      { new: true },
    );
  }
}
