import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { DentalCatalogUpsertDto } from './dto/dental-catalog-upsert.dto';
import { DentalCatalog } from './entities/dental-catalog.entity';

@Injectable()
export class DentalCatalogService {
  constructor(
    @InjectModel(DentalCatalog.name)
    private readonly dentalCatalogModel: Model<DentalCatalog>,
  ) {}

  findAll() {
    return this.dentalCatalogModel.find();
  }

  findOne(id: string) {
    return this.dentalCatalogModel.findById(id);
  }

  async upsert(doc: DentalCatalogUpsertDto, id?: string) {
    // Check if another document with the same name already exists
    const duplicate = await this.dentalCatalogModel.findOne({
      ...(id && { _id: { $ne: id } }),
      name: doc.name,
    });

    // Throw an error if a duplicate is found AND it's not the same document we are updating
    if (duplicate) {
      throw new BadRequestException(
        `A catalog item with the name "${doc.name}" already exists.`,
      );
    }

    return this.dentalCatalogModel.findOneAndUpdate(
      { _id: id || new mongoose.Types.ObjectId() },
      { $set: doc },
      { upsert: true, new: true },
    );
  }
}
