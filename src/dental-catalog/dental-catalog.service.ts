import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { DentalCatalogUpsertDto } from './dto/dental-catalog-upsert.dto';
import { DentalCatalog } from './entities/dental-catalog.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { UserActor, isAdmin } from '../auth/role-policy';
import { adminClinicIds, assertClinicAccess } from '../auth/clinic-policy';
import { clinicReferenceId } from '../users/clinic-membership';

export interface DentalCatalogView {
  _id: mongoose.Types.ObjectId;
  name: string;
  duration: number;
  clinics: string[];
  canEditDetails: boolean;
}

@Injectable()
export class DentalCatalogService {
  constructor(
    @InjectModel(DentalCatalog.name) private readonly dentalCatalogModel: Model<DentalCatalog>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
  ) {}

  async findAll(actor: UserActor, clinic?: string): Promise<DentalCatalogView[]> {
    if (clinic !== undefined) {
      clinic = this.validateId(clinic);
      assertClinicAccess(actor, clinic);
      if (!(await this.clinicModel.exists({ _id: clinic }))) throw new BadRequestException('Invalid clinic selected.');
    }
    const allowed = actor.role === 'admin' ? adminClinicIds(actor) : undefined;
    if (allowed?.length === 0) return [];
    const scope = clinic ? [clinic] : allowed;
    const filter = scope ? { $or: [{ clinics: { $in: scope } }, { clinics: { $exists: false } }] } : {};
    const services = await this.dentalCatalogModel.find(filter).lean();
    const allClinics = await this.allClinicIds();
    return services.map(service => this.visibleService(service, actor, allClinics));
  }

  async findOne(id: string, actor: UserActor): Promise<DentalCatalogView> {
    const service = await this.dentalCatalogModel.findById(this.validateId(id)).lean();
    if (!service) throw new NotFoundException('Service not found.');
    const allClinics = await this.allClinicIds();
    this.assertServiceAccess(service, actor, allClinics);
    return this.visibleService(service, actor, allClinics);
  }

  async upsert(doc: DentalCatalogUpsertDto, id: string | undefined, actor: UserActor): Promise<DentalCatalogView> {
    if (!isAdmin(actor)) throw new ForbiddenException('Only administrators may manage services.');
    if (id) id = this.validateId(id);
    const existing = id ? await this.dentalCatalogModel.findById(id).lean() : undefined;
    if (id && !existing) throw new NotFoundException('Service not found.');
    const allClinics = await this.allClinicIds();
    if (existing) this.assertServiceAccess(existing, actor, allClinics);
    if (!Array.isArray(doc.clinics)) throw new BadRequestException('Select clinic assignments for this service.');
    const selected = doc.clinics.map(clinic => this.validateId(clinic));
    if (new Set(selected).size !== selected.length) throw new BadRequestException('Clinic assignments must be unique.');
    if (!existing && !selected.length) throw new BadRequestException('Select at least one clinic for a new service.');
    const allowed = adminClinicIds(actor);
    if (actor.role === 'admin' && selected.some(clinic => !allowed.includes(clinic))) {
      throw new ForbiddenException('This clinic is outside your assignments.');
    }
    if (selected.some(clinic => !allClinics.includes(clinic))) throw new BadRequestException('Invalid clinic selected.');
    const name = doc.name.trim();
    if (name.length < 3) throw new BadRequestException('Service name must contain at least 3 characters.');
    const previous = existing ? this.serviceClinicIds(existing, allClinics) : [];
    const outside = actor.role === 'admin' ? previous.filter(clinic => !allowed.includes(clinic)) : [];
    if (existing && outside.length && (name !== existing.name || doc.duration !== existing.duration)) {
      throw new ForbiddenException('Only a super administrator may change details of a service shared with other clinics.');
    }
    const clinics = [...new Set([...outside, ...selected])];
    const duplicate = await this.dentalCatalogModel.findOne({ ...(id && { _id: { $ne: id } }), name });
    if (duplicate) throw new BadRequestException(`A catalog item with the name "${name}" already exists.`);
    try {
      // A stale admin edit must not erase concurrent changes to another clinic.
      const filter = { _id: id || new mongoose.Types.ObjectId(), ...(existing && actor.role === 'admin' ? {
        clinics: existing.clinics === undefined ? { $exists: false } : existing.clinics,
        name: existing.name, duration: existing.duration,
      } : {}) };
      const updated = await this.dentalCatalogModel.findOneAndUpdate(filter, { $set: { name, duration: doc.duration, clinics } }, {
        upsert: !id, new: true, runValidators: true,
      }).lean();
      if (!updated) throw new ConflictException('Service changed while editing. Reload it and try again.');
      return this.visibleService(updated, actor, allClinics);
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new BadRequestException(`A catalog item with the name "${name}" already exists.`);
      }
      throw error;
    }
  }

  private async allClinicIds(): Promise<string[]> {
    return (await this.clinicModel.find().select('_id').lean()).map(clinic => clinic._id.toString());
  }

  /** Missing assignments preserve legacy availability until guarded backfill. [] means unavailable. */
  private serviceClinicIds(service: DentalCatalog, allClinics: string[]): string[] {
    return service.clinics === undefined ? allClinics : service.clinics.map(clinicReferenceId).filter((id): id is string => !!id);
  }

  private assertServiceAccess(service: DentalCatalog, actor: UserActor, allClinics: string[]): void {
    if (actor.role === 'admin' && !this.serviceClinicIds(service, allClinics).some(clinic => adminClinicIds(actor).includes(clinic))) {
      throw new ForbiddenException('This service is outside your clinic assignments.');
    }
  }

  private visibleService(service: DentalCatalog & { _id: mongoose.Types.ObjectId }, actor: UserActor, allClinics: string[]): DentalCatalogView {
    const clinics = this.serviceClinicIds(service, allClinics);
    const allowed = adminClinicIds(actor);
    return { ...service, clinics: actor.role === 'admin' ? clinics.filter(clinic => allowed.includes(clinic)) : clinics,
      canEditDetails: actor.role === 'super-admin' || (actor.role === 'admin' && clinics.every(clinic => allowed.includes(clinic))),
    };
  }

  private validateId(id: string): string {
    if (!mongoose.isObjectIdOrHexString(id)) throw new BadRequestException('Invalid service or clinic ID.');
    return new mongoose.Types.ObjectId(id).toHexString();
  }
}
