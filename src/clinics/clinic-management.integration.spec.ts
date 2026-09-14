import { BadRequestException } from '@nestjs/common';
import { Connection, createConnection, Model } from 'mongoose';
import { Clinic, ClinicSchema } from './entities/clinic.entity';
import { ClinicsService } from './clinics.service';
import { User } from '../users/entities/user.entity';

const uri = process.env.TEST_MONGO_URI;
const localTests = uri ? describe : describe.skip;

localTests('Clinic name persistence', () => {
  let connection: Connection;
  let clinics: Model<Clinic>;
  let service: ClinicsService;
  const actor = { sub: '000000000000000000000001', role: 'super-admin' };
  const doc = {
    name: 'Annex Clinic',
    address: 'Manila',
    mobileNumber: '+639123456789',
    emailAddress: 'annex@example.test',
  };

  beforeAll(async () => {
    if (!uri?.startsWith('mongodb://127.0.0.1:27028/clinica_test')) {
      throw new Error('Use only the isolated local clinica_test database.');
    }
    connection = await createConnection(uri).asPromise();
    clinics = connection.model(Clinic.name, ClinicSchema);
    await clinics.init();
    service = new ClinicsService(clinics, {} as Model<User>);
  });
  beforeEach(async () => {
    await clinics.deleteMany({});
  });
  afterAll(async () => {
    await connection?.close();
  });

  it('stores one clinic for concurrent saves of the same canonical name', async () => {
    const results = await Promise.allSettled([
      service.upsert(doc, undefined, actor),
      service.upsert({ ...doc, name: ' annex clinic ' }, undefined, actor),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason).toBeInstanceOf(
      BadRequestException,
    );
    expect(await clinics.countDocuments()).toBe(1);
  });

  it('recognizes an existing name without rewriting a legacy clinic', async () => {
    const legacy = await clinics.create({ ...doc, name: ' Annex Clinic ' });
    await expect(service.upsert(doc, undefined, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const saved = await clinics.findById(legacy._id).select('+nameKey').lean();
    expect(saved?.name).toBe(' Annex Clinic ');
    expect(saved?.nameKey).toBeUndefined();
  });
});
