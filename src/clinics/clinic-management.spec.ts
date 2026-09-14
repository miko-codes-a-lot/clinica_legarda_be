import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Model } from 'mongoose';
import { ClinicsService } from './clinics.service';
import { Clinic } from './entities/clinic.entity';
import { User } from '../users/entities/user.entity';
import { ClinicUpsertDto } from './dto/clinic-upsert.dto';

const doc: ClinicUpsertDto = {
  name: 'Annex Clinic',
  address: 'Manila',
  mobileNumber: '+639123456789',
  emailAddress: 'annex@example.test',
};

describe('Clinic management', () => {
  let clinics: {
    findOne: jest.Mock;
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let service: ClinicsService;
  const save = (role: string, id?: string) =>
    Reflect.apply(service.upsert, service, [
      doc,
      id,
      { sub: '000000000000000000000001', role },
    ]);

  beforeEach(() => {
    clinics = {
      findOne: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue(doc),
    };
    service = new ClinicsService(
      clinics as unknown as Model<Clinic>,
      {} as Model<User>,
    );
  });

  it.each(['admin', 'dentist', 'user'])(
    'rejects clinic creation by %s',
    async (role) => {
      await expect(save(role)).rejects.toBeInstanceOf(ForbiddenException);
      expect(clinics.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('allows a super admin to create a clinic', async () => {
    await expect(save('super-admin')).resolves.toMatchObject({
      name: 'Annex Clinic',
    });
  });

  it('rejects an admin update before reading or changing the clinic', async () => {
    await expect(
      save('admin', '000000000000000000000099'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(clinics.findById).not.toHaveBeenCalled();
    expect(clinics.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('reports a concurrent duplicate name as a business error', async () => {
    clinics.findOneAndUpdate.mockRejectedValue({ code: 11000 });
    await expect(save('super-admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a duplicate clinic name', async () => {
    clinics.findOne.mockResolvedValue({ name: 'Annex Clinic' });
    await expect(save('super-admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not create a new clinic when an update ID is missing', async () => {
    await expect(
      save('super-admin', '000000000000000000000099'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(clinics.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
