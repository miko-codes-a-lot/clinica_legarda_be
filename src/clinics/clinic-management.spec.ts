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
import { validateSync } from 'class-validator';

const doc: ClinicUpsertDto = {
  name: 'Annex Clinic',
  address: 'Manila',
  mobileNumber: '+639123456789',
  emailAddress: 'annex@example.test',
};

describe('Clinic management', () => {
  it('rejects explicit null appointment-only days at the API validation boundary', () => {
    const value = Object.assign(new ClinicUpsertDto(), { ...doc, appointmentOnlyDays: null });
    expect(validateSync(value).some(error => error.property === 'appointmentOnlyDays')).toBe(true);
  });
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
  it('persists appointment-only days without replacing existing weekly hours implicitly', async () => {
    await service.upsert({ ...doc, appointmentOnlyDays: ['sunday'] }, undefined, { sub: '000000000000000000000001', role: 'super-admin' });
    expect(clinics.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ appointmentOnlyDays: ['sunday'] });
    expect(clinics.findOneAndUpdate.mock.calls[0][1].$set.operatingHours).toBeUndefined();
  });

  it('rejects ambiguous fixed hours and appointment-only availability on the same day', async () => {
    await expect(service.upsert({ ...doc, appointmentOnlyDays: ['sunday'], operatingHours: [{ day: 'sunday', startTime: '09:00', endTime: '17:00' }] }, undefined,
      { sub: '000000000000000000000001', role: 'super-admin' })).rejects.toThrow('both fixed hours and by appointment');
    expect(clinics.findOneAndUpdate).not.toHaveBeenCalled();
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
